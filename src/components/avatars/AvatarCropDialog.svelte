<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../../lib/i18n';
  import { AVATAR_SHAPE, MIN_ZOOM, OUTPUT_MAX, startCrop, type Crop, type Size } from '../../lib/avatars/avatar-crop';
  import { MAX_AVATAR_SOURCE_BYTES, canSaveAvatar } from '../../lib/avatars/avatar';
  import { rectOf } from '../../lib/images/crop';
  import { OUTPUT_TYPE, renderRect } from '../../lib/images/crop-render';
  import { MAX_CROP_SOURCE_PIXELS, MIN_CROP_SOURCE_SIDE, openCropSource, type CropSourceProblem } from '../../lib/images/crop-source';
  import { routeHref } from '../../lib/routing/routes';
  import CropStage from '../common/CropStage.svelte';
  import FormError from '../common/FormError.svelte';
  import ModalShell from '../ui/ModalShell.svelte';
  import OfflineNote from '../common/OfflineNote.svelte';

  interface Props {
    /** The picture the writer chose (already checked for type and size). */
    file: File;
    online: boolean;
    /** The failure of the last send, from the app's form errors. */
    error: string;
    /** Sends the cut square; true when it was stored (the dialog then closes). */
    onSave: (square: File) => Promise<boolean>;
    onClose: () => void;
  }

  let { file, online, error, onSave, onClose }: Props = $props();
  const PROBLEM_TEXT = {
    unreadable: 'account.avatar.unreadable',
    heic: 'upload.reason.heic',
    tooManyPixels: 'account.avatar.problem.tooManyPixels',
    tooSmall: 'account.avatar.problem.tooSmall',
  } as const;

  let image = $state<ImageBitmap>();
  let size = $state<Size>({ width: 0, height: 0 });
  let crop = $state<Crop>({ zoom: MIN_ZOOM, x: 0, y: 0 });
  /** Why the file cannot be used: not readable as a picture, a HEIC photo this browser cannot convert, or too large or too small a picture. */
  let problem = $state<CropSourceProblem>();
  /** The square could not be encoded (the canvas gave no picture). */
  let processFailed = $state(false);
  let busy = $state(false);
  let notice = $state<HTMLElement>();

  // The file is decoded here, in the browser (`openCropSource`: HEIC converted first, the header checked before decoding, an
  // ImageBitmap turned upright by its EXIF orientation: its size is what the writer sees).
  onMount(() => {
    let active = true;
    void openCropSource(file, MAX_AVATAR_SOURCE_BYTES, () => active).then((opened) => {
      if (!opened) return;
      if ('problem' in opened) {
        if (active) problem = opened.problem;
        return;
      }
      size = { width: opened.bitmap.width, height: opened.bitmap.height };
      crop = startCrop(size);
      image = opened.bitmap;
    });
    return () => {
      active = false;
      image?.close();
    };
  });

  // The notice is part of this dialog: Save is not possible while it is not on the screen.
  const canSave = $derived(canSaveAvatar({ noticeShown: !!notice, ready: !!image, online, busy }));

  async function save() {
    if (!image || !canSave) return;
    busy = true;
    processFailed = false;
    try {
      let blob: Blob;
      try {
        blob = await renderRect(image, rectOf(crop, size, AVATAR_SHAPE), OUTPUT_MAX);
      } catch {
        // A canvas that cannot encode: the dialog says so and stays open (another picture, or another try).
        processFailed = true;
        return;
      }
      if (await onSave(new File([blob], 'profile-picture.jpg', { type: OUTPUT_TYPE }))) onClose();
    } finally {
      busy = false;
    }
  }
</script>

<ModalShell
  title={$t('account.avatar.dialog.title')}
  initialFocus=".crop-stage"
  sheet
  onClose={() => {
    if (!busy) onClose();
  }}>
  <FormError
    message={problem ? PROBLEM_TEXT[problem] : ''}
    values={{ max: MAX_CROP_SOURCE_PIXELS / 1_000_000, min: MIN_CROP_SOURCE_SIDE }} />
  <CropStage
    {image}
    {size}
    shape={AVATAR_SHAPE}
    bind:crop
    {busy}
    failed={!!problem}
    variant="round"
    label={$t('account.avatar.stage')}
    help={$t('account.avatar.dialog.help')}
    zoomLabel={$t('crop.zoom')}
    zoomInLabel={$t('crop.zoomIn')}
    zoomOutLabel={$t('crop.zoomOut')}
    position={(values) => $t('crop.position', { values })} />
  <!-- Said before anything can be sent, in the words of the terms: who sees the picture, and what it may show. -->
  <div
    class="avatar-crop__notice"
    bind:this={notice}>
    <p class="avatar-crop__visible">{$t('account.avatar.visible')}</p>
    <p class="avatar-crop__rule">{$t('account.avatar.rule')}</p>
    <a
      class="avatar-crop__terms"
      href={routeHref({ name: 'terms' })}
      target="_blank"
      rel="noopener noreferrer">
      {$t('account.avatar.terms')}
    </a>
  </div>
  <FormError message={processFailed ? 'account.avatar.processFailed' : error} />
  <OfflineNote
    {online}
    message={$t('account.avatar.offline')} />
  <div class="button-row button-row--end avatar-crop__actions">
    <button
      type="button"
      class="button"
      disabled={busy}
      onclick={onClose}>
      {$t('common.cancel')}
    </button>
    <button
      type="button"
      class="button button--primary"
      disabled={!canSave}
      onclick={() => void save()}>
      {busy ? $t('account.avatar.saving') : $t('account.avatar.save')}
    </button>
  </div>
</ModalShell>

<style>
  .avatar-crop__notice {
    margin: 0 0 var(--space-3);
    padding: var(--space-3);
    border: 0.125rem solid var(--accent);
    border-radius: var(--radius-sm);
    background: var(--sage);
    color: var(--ink);
    font-size: var(--font-base);
  }
  .avatar-crop__notice p {
    margin: 0 0 var(--space-2);
  }
  .avatar-crop__visible {
    font-weight: 700;
  }
  .avatar-crop__terms {
    color: var(--accent);
    font-weight: 600;
    text-underline-offset: 0.2em;
  }
  /* Save and Cancel stay in reach when the dialog scrolls (a landscape phone, a large text size). */
  .avatar-crop__actions {
    position: sticky;
    /* The dialog's own bottom padding (the scroll box is its content area), so the bar sits on the dialog's edge. */
    bottom: calc(-1 * var(--space-9));
    padding: var(--space-3) 0;
    background: var(--surface);
  }
  @media (width < 45em) {
    /* The sheet's bottom padding is max(--space-5, --safe-bottom): the bar's ground covers it, its buttons stand above the inset. */
    .avatar-crop__actions {
      bottom: calc(-1 * max(var(--space-5), var(--safe-bottom)));
      margin-bottom: calc(-1 * var(--safe-bottom));
      padding-bottom: calc(var(--space-3) + var(--safe-bottom));
    }
  }
  @media (pointer: coarse) {
    .avatar-crop__terms {
      display: inline-flex;
      align-items: center;
      min-height: var(--touch-target);
    }
  }
</style>
