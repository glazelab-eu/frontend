import { ApiError, api } from '../../lib/api/client';
import type { Glaze, GlazeCreated, GlazeHistory, UploadTarget } from '../../lib/api/models';
import type { BarcodeChange, CombinationInput, GlazeChange, GlazeInput, TagChange } from '../../lib/api/inputs';
import { dropCachedImages } from '../../lib/offline/offline';
import { glazeWithBarcode } from '../../lib/barcodes/barcodes';
import { withCombinationTitle, withCorrectedGlaze, withNewGlaze, withoutGlaze, type FormName } from '../app/app-state';
import type { AppContext } from '../app/context';
import { GONE, ifGone } from '../app/gone';
import { isLoading } from '../../lib/sync/lifecycle';

/**
 * Catalog writes and reads: adding and correcting glazes, their tags and barcodes, Studio's combinations and the favourites. Each
 * patches the listings in place where it can (and saves the snapshot), else reloads.
 */
export function createCatalogActions(
  ctx: Pick<AppContext, 'read' | 'patch' | 'stale' | 'notify' | 'query' | 'mutate' | 'mutateFor' | 'load' | 'saveCurrent' | 'go' | 'visit'>,
  { onSaved, openAuth }: { onSaved: () => void; openAuth: () => void },
) {
  /**
   * Adds a glaze (with its shelf entry, when the input has a stock part) and patches the created glaze
   * and entry into the listings without a reload, so open lists keep their place. Resolves to the API's
   * answer (the glaze is already in the store) or null.
   */
  function addGlaze(input: GlazeInput): Promise<GlazeCreated | null> {
    return ctx.mutateFor({
      request: () => api.addGlaze(input),
      apply: async (added, actor) => {
        ctx.patch(withNewGlaze(ctx.read(), added));
        await ctx.saveCurrent(actor);
        return added;
      },
      notice: input.stock ? 'notices.glazeAddedToShelf' : 'notices.glazeAdded',
      form: 'glaze',
    });
  }

  /**
   * Saves Studio's combination and opens it. With `draft` a new combination is saved as a draft and
   * an edited draft stays one; otherwise a new one is published, and an edited draft is saved and
   * then published. Edits of a published combination keep it published either way. The result opens
   * only while the writer is still on the Studio visit that started the save: a save in flight cannot
   * be called back, so after the writer went elsewhere (Discard, Back, a link) it only reports.
   * `open: false` stays in Studio (its photos go to the saved combination next). Resolves to the
   * combination's ID, or null after a failure.
   */
  function saveCombination(input: CombinationInput, id?: string, draft = false, { open = true } = {}) {
    const wasDraft = !!id && !!ctx.read().combinations.find((combo) => combo.id === id)?.draft;
    const publishing = !draft && wasDraft;
    const startedAt = ctx.visit();
    let away = false;
    return ctx.mutateFor({
      request: async () => {
        if (!id) return (await api.saveCombination({ ...input, draft })).id;
        await api.updateCombination(id, input);
        if (publishing) await api.publishCombination(id);
        return id;
      },
      apply: async (destination, actor) => {
        await ctx.load();
        if (ctx.stale(actor)) return false;
        if (ctx.visit() !== startedAt) away = true;
        else if (open) ctx.go({ name: 'combination', id: destination }, { replace: true });
        return destination;
      },
      notice: () =>
        away ? 'notices.combinationSavedAway' : draft ? 'notices.draftSaved' : publishing ? 'notices.combinationPublished' : 'notices.combinationSaved',
      // Studio shows a failure while its visit lasts; after the writer left, the banner does.
      form: () => (ctx.visit() === startedAt ? 'combination' : undefined),
      requireOnline: true,
      reloadOn: id ? [409] : [],
    });
  }

  /** The author publishes a draft from its page; it and its photos then show as each photo's visibility says. */
  function publishCombination(id: string) {
    return ctx.mutate({
      request: () => api.publishCombination(id),
      apply: () => ctx.load(),
      notice: 'notices.combinationPublished',
      form: 'combination',
    });
  }

  /**
   * Corrects only a combination's title (its author, or a site admin on someone else's) and patches it into the listings and
   * the snapshot without a reload. A combination removed meanwhile (404) reloads the listings and says so; a refusal (403:
   * the admin flag went meanwhile) reloads them too and shows at the form.
   */
  function retitleCombination(id: string, title: string) {
    return ctx.mutate({
      request: () => ifGone(() => api.retitleCombination(id, title)),
      apply: async (answer, actor) => {
        if (answer === GONE) {
          await ctx.load();
          if (ctx.stale(actor)) return false;
          ctx.notify('notices.combinationGone', actor);
          return;
        }
        ctx.patch(withCombinationTitle(ctx.read(), id, answer.title));
        await ctx.saveCurrent(actor);
        ctx.notify('notices.combinationRenamed', actor);
      },
      form: 'combination-title',
      requireOnline: true,
      reloadOn: [403],
      busy: `combination-title:${id}`,
    });
  }

  function removeCombination(id: string) {
    const startedAt = ctx.visit();
    return ctx.mutate({
      request: async () => {
        const urls =
          ctx
            .read()
            .combinations.find((combo) => combo.id === id)
            ?.images.map((image) => image.url) ?? [];
        await api.removeCombination(id);
        return urls;
      },
      apply: async (urls, actor) => {
        ctx.patch({
          combinations: ctx.read().combinations.filter((combo) => combo.id !== id),
          favorites: {
            ...ctx.read().favorites,
            combinationIds: ctx.read().favorites.combinationIds.filter((value) => value !== id),
          },
        });
        await dropCachedImages(actor, urls);
        await ctx.saveCurrent(actor);
        if (ctx.stale(actor)) return false;
        if (ctx.visit() === startedAt) ctx.go({ name: 'discover', type: 'combinations' }, { replace: true });
      },
      notice: 'notices.combinationDeleted',
      form: () => (ctx.visit() === startedAt ? 'combination' : undefined),
      requireOnline: true,
      reloadOn: [409, 404],
    });
  }

  /** Counts the favourite writes: only the newest one's totals are applied (FE-11). */
  let favoriteWrites = 0;

  /**
   * Stars or unstars one item. The answer patches only that ID into the favourites as they are when it arrives, so
   * answers arriving out of order (star A, then B, A's answer last) never undo another star on screen or in the snapshot;
   * the full list comes with the next load. The totals are read after the write and applied only from the newest write,
   * so an older read never replaces newer totals.
   */
  function setFavorite(kind: 'glazes' | 'combinations', id: string, active: boolean) {
    const write = ++favoriteWrites;
    return ctx.mutate({
      request: async () => {
        await api.setFavorite(kind, id, active);
        return api.favoriteCounts().catch(() => undefined);
      },
      apply: async (counts, actor) => {
        const { favorites, favoriteCounts } = ctx.read();
        const key = kind === 'glazes' ? 'glazeIds' : 'combinationIds';
        const ids = favorites[key].filter((other) => other !== id);
        ctx.patch({
          favorites: { ...favorites, [key]: active ? [...ids, id] : ids },
          favoriteCounts: counts && write === favoriteWrites ? counts : favoriteCounts,
        });
        await ctx.saveCurrent(actor);
        if (active && !ctx.stale(actor)) onSaved();
      },
      requireOnline: true,
    });
  }

  /** The star: a guest gets the sign-in dialog and nothing is sent; an account switches the favourite as it is now. */
  function toggleFavorite(kind: 'glazes' | 'combinations', id: string) {
    if (!ctx.read().user) {
      if (!isLoading(ctx.read().sync)) openAuth();
      return Promise.resolve(false);
    }
    const { glazeIds, combinationIds } = ctx.read().favorites;
    return setFavorite(kind, id, !(kind === 'glazes' ? glazeIds : combinationIds).includes(id));
  }

  /** Adds or removes tags of a glaze or combination and keeps the result in the listing. */
  function editTags(target: Pick<UploadTarget, 'type' | 'id'>, change: TagChange) {
    return ctx.mutate({
      request: () => api.editTags(target, change),
      apply: async ({ tags }, actor) => {
        const tagged = <T extends { id: string; tags: string[] }>(items: T[]) => items.map((item) => (item.id === target.id ? { ...item, tags } : item));
        const { glazes, combinations } = ctx.read();
        ctx.patch(target.type === 'glaze' ? { glazes: tagged(glazes) } : { combinations: tagged(combinations) });
        await ctx.saveCurrent(actor);
      },
      requireOnline: true,
    });
  }

  /**
   * The glaze whose packaging carries a normalized barcode, or null when none does. Online the API
   * answers (another user may have added the barcode since the last load; the listings then reload
   * so the glaze can be shown); offline, or when the API cannot answer, the loaded listing does.
   */
  async function findBarcode(barcode: string): Promise<Glaze | null> {
    const actor = ctx.read().user?.id;
    const local = () => glazeWithBarcode(ctx.read().glazes, barcode) ?? null;
    if (!ctx.read().online) return local();
    try {
      const found = await api.glazeByBarcode(barcode);
      if (ctx.stale(actor)) return null;
      if (!ctx.read().glazes.some((glaze) => glaze.id === found.id)) await ctx.load();
      return ctx.read().glazes.find((glaze) => glaze.id === found.id) ?? found;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      return local();
    }
  }

  /** Adds or removes barcodes of a glaze and keeps the result in the listing; `form` reports a failure there (the add dialog) instead of in the banner. */
  function editBarcodes(id: string, change: BarcodeChange, form?: FormName) {
    return ctx.mutate({
      form,
      request: () => api.editBarcodes(id, change),
      apply: async ({ barcodes }, actor) => {
        ctx.patch({
          glazes: ctx.read().glazes.map((glaze) => (glaze.id === id ? { ...glaze, barcodes } : glaze)),
        });
        await ctx.saveCurrent(actor);
      },
      requireOnline: true,
    });
  }

  /**
   * Corrects a glaze's name, notes or code (`change` holds only what differs) and puts the answered glaze
   * in the listings. A glaze removed meanwhile (404) reloads the listings and says so; a code that is
   * locked (403) or taken (409) reloads them too, so the page's hint follows, and shows at the form.
   */
  function correctGlaze(id: string, change: GlazeChange) {
    return ctx.mutate({
      request: () => ifGone(() => api.correctGlaze(id, change)),
      apply: async (glaze, actor) => {
        if (glaze === GONE) {
          await ctx.load();
          if (ctx.stale(actor)) return false;
          ctx.notify('notices.glazeGone', actor);
          return;
        }
        ctx.patch(withCorrectedGlaze(ctx.read(), glaze));
        await ctx.saveCurrent(actor);
        ctx.notify('notices.glazeCorrected', actor);
      },
      form: 'glaze-edit',
      requireOnline: true,
      reloadOn: [403, 409],
      busy: `glaze-edit:${id}`,
    });
  }

  /** The public change log of a glaze (guests too), or null offline or after a failure (shown at its dialog). */
  async function glazeHistory(id: string): Promise<GlazeHistory | null> {
    if (!ctx.read().online) return null;
    return ctx.query(() => api.glazeHistory(id), 'glaze-history');
  }

  /**
   * Site admins remove a glaze completely. On success it leaves the listings and the snapshot
   * and the glaze route is replaced by the glaze list; after a 409 (combinations use it) or a
   * 404 the listings are reloaded so the page shows the current state.
   */
  async function removeGlaze(id: string) {
    if (!ctx.read().user?.siteAdmin) return false;
    const startedAt = ctx.visit();
    return ctx.mutate({
      request: () => api.removeGlaze(id),
      apply: async (_, actor) => {
        ctx.patch(withoutGlaze(ctx.read(), id));
        await ctx.saveCurrent(actor);
        // Someone who went elsewhere meanwhile stays there.
        if (ctx.visit() === startedAt) ctx.go({ name: 'discover', type: 'glazes' }, { replace: true });
      },
      notice: 'notices.glazeRemoved',
      // The confirm dialog shows a failure while its page lasts; after the person left, the banner does.
      form: () => (ctx.visit() === startedAt ? 'glaze-remove' : undefined),
      requireOnline: true,
      reloadOn: [409, 404],
    });
  }

  return {
    addGlaze,
    saveCombination,
    publishCombination,
    retitleCombination,
    removeCombination,
    setFavorite,
    toggleFavorite,
    editTags,
    findBarcode,
    editBarcodes,
    correctGlaze,
    glazeHistory,
    removeGlaze,
  };
}
