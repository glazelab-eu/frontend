import { ApiError, api } from '../../lib/api/client';
import type { Buddy, BuddyAvailability, BuddyPreview } from '../../lib/api/models';
import { isLinkToken } from '../../lib/buddies/buddies';
import type { MessageKey } from '../../lib/i18n';
import { canonicalUrl } from '../../lib/share/share';
import { buddyMemberForm, type FormName } from '../app/app-state';
import type { AppContext } from '../app/context';
import { isLoading } from '../../lib/sync/lifecycle';

/** The part of a buddy (or of a club member) an answer needs. */
type BuddyName = Pick<Buddy, 'id' | 'displayName'>;

/**
 * Buddies: the lists read again, the buddy link (preview, request, create or replace) and the answers about a pair. Owns this session's
 * buddy token (dropped on an account change through `onAccountChange`). `reloadBuddies` is also handed to the load module, for `refreshAvatarIds`.
 */
export function createBuddyActions(
  ctx: Pick<AppContext, 'read' | 'patch' | 'stale' | 'notify' | 'query' | 'mutate' | 'mutateFor' | 'saveCurrent' | 'go' | 'onAccountChange'>,
  { availabilityOf }: { availabilityOf: () => Promise<BuddyAvailability> },
) {
  /**
   * The account's buddy link generated in this session: the API answers the token only when it creates or replaces the
   * link, so the Buddies section shows it from here until a reload. Memory only (never the store, a snapshot, storage
   * or history); dropped on an account change.
   */
  let buddyToken: string | null = null;
  ctx.onAccountChange(() => {
    buddyToken = null;
  });

  /**
   * Fetches the buddy lists and the availability again and keeps them (and the snapshot) when the account is still the one that asked.
   * It follows a write that succeeded, so a failed read (429, 5xx, unreachable) keeps the lists on show for the page-open reload
   * to bring later; only a 401 is rethrown, for the session check.
   */
  async function refreshBuddies(actor: string | undefined) {
    try {
      const [buddies, buddyAvailability] = await Promise.all([api.buddies(), availabilityOf()]);
      if (ctx.stale(actor)) return;
      ctx.patch({ buddies, buddyAvailability });
      await ctx.saveCurrent(actor);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) throw error;
    }
  }

  /**
   * Reads the buddy lists again when a page that shows them opens (a request may have arrived, or been answered, on
   * another device since the last load). Silent: a failure leaves the lists on show, and nothing changes when they are
   * the same; a load in progress brings them anyway.
   */
  async function reloadBuddies() {
    const actor = ctx.read().user?.id;
    if (!actor || !ctx.read().online || isLoading(ctx.read().sync)) return;
    try {
      const buddies = await api.buddies();
      if (ctx.stale(actor) || JSON.stringify(buddies) === JSON.stringify(ctx.read().buddies)) return;
      // The lists changed (a request was answered elsewhere): the availability follows them.
      const buddyAvailability = await availabilityOf();
      if (ctx.stale(actor)) return;
      ctx.patch({ buddies, buddyAvailability });
      await ctx.saveCurrent(actor);
    } catch {
      /* The next load reports it. */
    }
  }

  /**
   * What a buddy link offers (the owner's display name and how the account stands to them); nothing is requested. Null after
   * a failure; a token of the wrong shape is invalid without a request.
   */
  function previewBuddyLink(token: string): Promise<BuddyPreview | null> {
    if (!isLinkToken(token)) {
      ctx.patch({ formError: { form: 'buddy', message: 'errors.buddyLinkInvalid' } });
      return Promise.resolve(null);
    }
    return ctx.query(() => api.previewBuddyLink(token), 'buddy');
  }

  /**
   * Asks the owner of a buddy link to be buddies (or accepts their request to this account: asking back is accepting).
   * The route is replaced by the account page so the token leaves the history, and one notice says what happened.
   */
  function requestBuddy(token: string, name: string) {
    return ctx.mutate({
      request: () => api.requestBuddyByLink(token),
      apply: async ({ relation }, actor) => {
        ctx.go({ name: 'account' }, { replace: true });
        await refreshBuddies(actor);
        ctx.notify(relation === 'BUDDIES' ? 'notices.buddiesNow' : 'notices.buddyRequested', actor, { name });
      },
      requireOnline: true,
      busy: 'buddy-request',
      form: 'buddy',
    });
  }

  /**
   * Creates (`replace` false: the page knew of no link) or replaces (after the question) the account's buddy link and answers
   * it (shown from memory until a reload), or null after a failure. The API always replaces, so a create first reads the
   * lists: a link made meanwhile on another device or tab is never replaced without the question; the page learns of it.
   */
  function createBuddyLink(replace: boolean): Promise<string | null> {
    return ctx.mutateFor({
      request: async (actor) => {
        if (!replace) {
          const buddies = await api.buddies();
          if (buddies.hasLink) {
            if (ctx.stale(actor)) return false;
            ctx.patch({ buddies, formError: { form: 'buddy-link', message: 'errors.buddyLinkExists' } });
            await ctx.saveCurrent(actor);
            return false;
          }
        }
        return api.replaceBuddyLink();
      },
      apply: async ({ token }, actor) => {
        buddyToken = token;
        ctx.patch({ buddies: { ...ctx.read().buddies, hasLink: true } });
        await ctx.saveCurrent(actor);
        return buddyLink();
      },
      requireOnline: true,
      busy: 'buddy-link',
      form: 'buddy-link',
    });
  }

  /** The buddy link generated in this session, or null (none yet, or the page was reloaded: the API keeps only its hash). */
  function buddyLink(): string | null {
    return buddyToken ? canonicalUrl({ name: 'buddy', token: buddyToken }, location) : null;
  }

  /** A club member is asked to be buddies; the lists reload, so the row turns to "Request sent" (or "Buddies" for a crossed request). */
  function requestBuddyInClub(clubId: string, userId: string) {
    return ctx.mutate({
      request: () => api.requestBuddyInClub(clubId, userId),
      apply: (_, actor) => refreshBuddies(actor),
      requireOnline: true,
      // 403/404: the account or that member left the club meanwhile; the reload refreshes the club before the refusal shows.
      reloadOn: [403, 404],
      busy: `buddy-member:${userId}`,
      form: buddyMemberForm(userId),
    });
  }

  /**
   * One of the answers about a pair; a stale page (the pair changed elsewhere) reloads before the refusal shows, at the
   * Buddies section or, for an accept on a club member's row, at that row (`form`).
   */
  function buddyAction(buddy: BuddyName, request: () => Promise<unknown>, notice: MessageKey, form: FormName = 'buddies') {
    return ctx.mutate({
      request,
      apply: async (_, actor) => {
        await refreshBuddies(actor);
        ctx.notify(notice, actor, { name: buddy.displayName });
      },
      requireOnline: true,
      reloadOn: [404, 409],
      busy: `buddy:${buddy.id}`,
      form,
    });
  }

  const acceptBuddy = (buddy: BuddyName, form?: FormName) => buddyAction(buddy, () => api.acceptBuddy(buddy.id), 'notices.buddiesNow', form);
  const declineBuddy = (buddy: BuddyName) => buddyAction(buddy, () => api.declineBuddy(buddy.id), 'notices.buddyDeclined');
  const cancelBuddyRequest = (buddy: BuddyName) => buddyAction(buddy, () => api.cancelBuddyRequest(buddy.id), 'notices.buddyCancelled');
  const removeBuddy = (buddy: BuddyName) => buddyAction(buddy, () => api.removeBuddy(buddy.id), 'notices.buddyRemoved');

  return {
    reloadBuddies,
    previewBuddyLink,
    requestBuddy,
    createBuddyLink,
    buddyLink,
    requestBuddyInClub,
    acceptBuddy,
    declineBuddy,
    cancelBuddyRequest,
    removeBuddy,
  };
}
