import { ApiError, api, errorMessage } from '../../lib/api/client';
import type { ImageInfo, UploadTarget } from '../../lib/api/models';
import type { ImageDetailsChange, ImageUploadInput, ImageVisibilityChange } from '../../lib/api/inputs';
import { dropCachedImages } from '../../lib/offline/offline';
import { uploadFailureMessage } from '../../lib/images/heic';
import type { UploadResult, UploadVisibility } from '../../lib/images/upload-queue';
import { withImage, withNewImage, withoutImage, type AppState } from '../app/app-state';
import type { AppContext } from '../app/context';
import { GONE, ifGone } from '../app/gone';

/**
 * Photos and pictures: uploads, visibility and detail changes, reports, deletion, and the upload and removal dialogs. A photo or
 * picture gone meanwhile (404) counts as done (`ifGone`). `refreshAvatarIds` is the load module's (it reads the load count).
 */
/** A removal dialog starts and ends without the error of an earlier attempt; another form's error stays. */
const withoutRemovalError = (state: Pick<AppState, 'formError'>) => (state.formError?.form === 'image-remove' ? { formError: null } : {});

export function createImageActions(
  ctx: Pick<AppContext, 'read' | 'patch' | 'stale' | 'notify' | 'mutate' | 'load' | 'saveCurrent'>,
  { refreshAvatarIds }: { refreshAvatarIds: () => Promise<void> },
) {
  /** Where the opener of the upload dialog wants focus when its button is gone once the dialog closes (kept past `closeUpload`: the dialog reads it as it unmounts). */
  let uploadReturnFocus: (() => boolean) | undefined;

  /**
   * One photo of an upload dialog. The returned picture joins its item (nothing reloads, so lists keep
   * their place and nodes); the dialog stays open and reports per file, so this answers why a file
   * failed instead of showing it, and whether later files would fail the same way.
   */
  async function uploadImage(input: ImageUploadInput): Promise<UploadResult> {
    let failure: unknown;
    const done = await ctx.mutate({
      request: async () => {
        try {
          return await api.uploadImage(input);
        } catch (error) {
          failure = error;
          throw error;
        }
      },
      apply: async (image, actor) => {
        ctx.patch(withNewImage(ctx.read(), input.target, image));
        await ctx.saveCurrent(actor);
      },
      form: 'upload',
      requireOnline: true,
    });
    if (done) return { ok: true };
    if (failure === undefined) return { ok: false, message: 'upload.notSent', stop: true };
    ctx.patch({ formError: null }); // `form` above only kept the failure off the banner; the dialog shows it at the file.
    const status = failure instanceof ApiError ? failure.status : -1;
    // Offline, signed out, terms to accept or rate limited: the next file would fail the same way.
    return { ok: false, message: uploadFailureMessage(input.file, errorMessage(failure)), stop: [0, 401, 428, 429].includes(status) };
  }

  /**
   * The uploader changes who may see a picture. Leaving PUBLIC moves it to a new ID and URL, so the
   * listings take the returned picture in place of the old one and the saved copy of the old URL goes.
   * A 404 (removed or moved meanwhile) counts as done: the listings reload and the notice says the
   * photo is gone (see `ifGone`).
   */
  async function changeImageVisibility(image: ImageInfo, change: ImageVisibilityChange) {
    if (!image.own) return false;
    return ctx.mutate({
      request: () => ifGone(() => api.changeImageVisibility(image.id, change)),
      apply: async (updated, actor) => {
        if (updated === GONE) return photoGone(actor);
        ctx.patch(withImage(ctx.read(), image.id, updated));
        await dropCachedImages(actor, [image.url]);
        await ctx.saveCurrent(actor);
        ctx.notify('notices.photoVisibilityChanged', actor);
      },
      form: 'image-visibility',
      requireOnline: true,
    });
  }

  /**
   * A signed-in user reports a photo they can see; the reason is optional. A repeated report is a
   * success too (the server keeps the first), the uploader's own photo is refused with a 400, and a
   * photo gone meanwhile (404) counts as done: reload and say so (see `ifGone`).
   */
  function reportImage(image: Pick<ImageInfo, 'id'>, reason: string | null) {
    return ctx.mutate({
      request: () => ifGone(() => api.reportImage(image.id, reason)),
      apply: async (reported, actor) => {
        if (reported === GONE) return photoGone(actor);
        ctx.notify('notices.photoReported', actor);
      },
      form: 'image-report',
      requireOnline: true,
      busy: `reporting:${image.id}`,
    });
  }

  /**
   * A signed-in member reports someone else's profile picture (31-3); the reason is optional, a repeated report is a success (the server
   * keeps the first) and a picture already gone (404: replaced or removed meanwhile) counts as done too, with the lists read again. Nothing
   * about the picture is shown or kept by the report: the admins read it in their queue.
   */
  function reportAvatar(avatarId: string, reason: string | null) {
    let gone = false;
    return ctx.mutate({
      request: () => ifGone(() => api.reportAvatar(avatarId, reason)),
      apply: async (reported) => {
        gone = reported === GONE;
        if (gone) void refreshAvatarIds();
      },
      notice: () => (gone ? 'notices.avatarAlreadyGone' : 'notices.avatarReported'),
      form: 'avatar-report',
      requireOnline: true,
      busy: `reporting-avatar:${avatarId}`,
    });
  }

  /**
   * Whoever may delete a photo (`canDelete`: uploader, an admin of its club, a site admin) changes what it shows. The
   * photo keeps its ID and URL; the answer replaces it in every listing at once (its cover, thumbnails and the similar
   * looks' kind follow the state), and the sync delta brings it to other devices. A 404 counts as done like the others.
   */
  async function changeImageKind(image: ImageInfo, kind: ImageInfo['kind']) {
    if (!image.canDelete) return false;
    return ctx.mutate({
      request: () => ifGone(() => api.changeImageKind(image.id, kind)),
      apply: async (updated, actor) => {
        if (updated === GONE) return photoGone(actor);
        ctx.patch(withImage(ctx.read(), image.id, updated));
        await ctx.saveCurrent(actor);
        ctx.notify('notices.photoKindChanged', actor);
      },
      form: 'image-kind',
      requireOnline: true,
    });
  }

  /**
   * Whoever may change the type also sets where the cards' covers centre the photo (null: the centre). The photo keeps its ID,
   * URL and bytes; the answer replaces it in every listing and the snapshot, and the sync delta brings it to other devices.
   */
  async function changeImageFocus(image: ImageInfo, focus: { x: number; y: number } | null) {
    if (!image.canDelete) return false;
    return ctx.mutate({
      request: () => ifGone(() => api.changeImageFocus(image.id, focus)),
      apply: async (updated, actor) => {
        if (updated === GONE) return photoGone(actor);
        ctx.patch(withImage(ctx.read(), image.id, updated));
        await ctx.saveCurrent(actor);
        ctx.notify('notices.photoFocusChanged', actor);
      },
      form: 'image-focus',
      requireOnline: true,
    });
  }

  /**
   * The uploader edits a photo's caption and firing date (older clients also the kind); the change holds only the fields that differ.
   * The photo keeps its ID and URL, so the cached bytes stay. A 404 counts as done like a visibility change:
   * the dialog belongs to the vanished photo, so the listings reload and the notice says it is gone.
   */
  async function changeImageDetails(image: ImageInfo, change: ImageDetailsChange) {
    if (!image.own) return false;
    return ctx.mutate({
      request: () => ifGone(() => api.changeImageDetails(image.id, change)),
      apply: async (updated, actor) => {
        if (updated === GONE) return photoGone(actor);
        ctx.patch(withImage(ctx.read(), image.id, updated));
        await ctx.saveCurrent(actor);
        ctx.notify('notices.photoDetailsChanged', actor);
      },
      form: 'image-details',
      requireOnline: true,
    });
  }

  /** After `GONE`: the listings reload and the notice says so; false when the account changed. */
  async function photoGone(actor: string | undefined) {
    await ctx.load();
    if (ctx.stale(actor)) return false;
    ctx.notify('notices.photoAlreadyDeleted', actor);
  }

  /**
   * A picture already gone (404) counts as deleted: the listings reload and the notice says so. Only
   * the ID and URL are needed, so the report queue can delete a photo the listings do not hold.
   */
  function deleteImage(image: Pick<ImageInfo, 'id' | 'url'>) {
    return ctx.mutate({
      request: () => ifGone(() => api.deleteImage(image.id)),
      apply: async (deleted, actor) => {
        if (deleted === GONE && (await photoGone(actor)) === false) return false;
        ctx.patch({ ...withoutImage(ctx.read(), image.id), removingImage: null });
        await dropCachedImages(actor, [image.url]);
        await ctx.saveCurrent(actor);
        if (deleted !== GONE) ctx.notify('notices.photoDeleted', actor);
      },
      form: 'image-remove',
      requireOnline: true,
      busy: `deleting:${image.id}`,
    });
  }

  return {
    uploadImage,
    changeImageVisibility,
    changeImageDetails,
    changeImageKind,
    changeImageFocus,
    reportImage,
    reportAvatar,
    deleteImage,
    openImageRemoval: (image: ImageInfo) => {
      if (ctx.read().user && ctx.read().online && image.canDelete) ctx.patch({ removingImage: image, ...withoutRemovalError(ctx.read()) });
    },
    closeImageRemoval: () => ctx.patch({ removingImage: null, ...withoutRemovalError(ctx.read()) }),
    /** `returnFocus` places focus when the opener's button is gone after the dialog closed (a row that left); it answers whether it did. */
    openUpload: (target: UploadTarget, returnFocus?: () => boolean) => {
      uploadReturnFocus = returnFocus;
      ctx.patch({ uploadFor: target, formError: null });
    },
    /** The upload dialog's fallback focus: the opener's own choice, if it made one and it took effect. */
    returnUploadFocus: () => uploadReturnFocus?.() ?? false,
    /** Closes the dialog; `added` photos went in meanwhile (they stay), which one notice reports. */
    closeUpload: (added = 0) => {
      ctx.patch({ uploadFor: null, formError: null });
      if (added > 0) ctx.notify('notices.photosAdded', undefined, { count: added });
    },
    rememberUploadVisibility: (uploadVisibility: UploadVisibility) => ctx.patch({ uploadVisibility }),
  };
}
