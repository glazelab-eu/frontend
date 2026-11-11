<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { t } from '../../lib/i18n';
  import type { Crop, Size } from '../../lib/images/crop';
  import { MAX_CROP_SOURCE_PIXELS, MIN_CROP_SOURCE_SIDE, openCropSource, type CropSourceProblem } from '../../lib/images/crop-source';
  import { pictureFocusFallback } from '../../lib/images/picture-focus';
  import { PHOTO_FOCUS, frameAt, frameFocus, type Focus } from '../../lib/images/photo-focus';
  import { MAX_UPLOAD_BYTES } from '../../lib/images/upload-queue';
  import CropStage from '../common/CropStage.svelte';
  import FormError from '../common/FormError.svelte';
  import OfflineNote from '../common/OfflineNote.svelte';
  import ModalShell from '../ui/ModalShell.svelte';

  interface Props {
    /** The whole photo: a chosen file (the JPEG of a HEIC) or a stored photo's full size; null when it cannot be had. */
    source: () => Promise<File | null>;
    /** The photo's name in the stage's label (its file name, or the photo's description). */
    name: string;
    /** The focus it has, to start from; none starts at the centre. */
    start: Focus | null;
    /** False disables Save and says why (a stored photo's change needs the connection). */
    online?: boolean;
    /** Why the last save failed, shown at the buttons. */
    error?: string;
    /** Takes the new focus (null: back to the centre); resolves true once kept, and the dialog closes. */
    onSave: (focus: Focus | null) => boolean | Promise<boolean>;
    onClose: () => void;
  }

  let { source, name, start, online = true, error = '', onSave, onClose }: Props = $props();
  /** A photo menu's card, for when the photo left with the opener. */
  const fallbackFocus = pictureFocusFallback();
  const PROBLEM_TEXT = {
    unreadable: 'upload.focus.unreadable',
    heic: 'upload.reason.heic',
    tooManyPixels: 'upload.focus.tooManyPixels',
    tooSmall: 'upload.focus.tooSmall',
  } as const;

  let image = $state<ImageBitmap>();
  let size = $state<Size>({ width: 0, height: 0 });
  let frame = $state<Crop>({ zoom: 1, x: 0, y: 0 });
  let problem = $state<CropSourceProblem>();
  let busy = $state(false);
  let failed = $state(false);

  // One bitmap while the dialog is open (at most 4096 × 4096 px, `openCropSource`), closed with it.
  onMount(() => {
    let active = true;
    void source()
      .catch(() => null)
      .then((file) => (file ? openCropSource(file, MAX_UPLOAD_BYTES, () => active) : ({ problem: 'unreadable' } as const)))
      .then((opened) => {
        if (!opened) return;
        if (!active) {
          if ('bitmap' in opened) opened.bitmap.close();
          return;
        }
        if ('problem' in opened) {
          problem = opened.problem;
          return;
        }
        size = { width: opened.bitmap.width, height: opened.bitmap.height };
        frame = frameAt(
          size,
          untrack(() => start),
        );
        image = opened.bitmap;
      });
    return () => {
      active = false;
      image?.close();
    };
  });

  async function save(focus: Focus | null) {
    if (busy || !online) return;
    busy = true;
    failed = false;
    try {
      failed = !(await onSave(focus));
      if (!failed) onClose();
    } finally {
      busy = false;
    }
  }
</script>

<ModalShell
  title={$t('upload.focus.title')}
  initialFocus=".crop-stage"
  {fallbackFocus}
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
    shape={PHOTO_FOCUS}
    bind:crop={frame}
    {busy}
    failed={!!problem}
    variant="focus"
    label={$t('upload.focus.stage', { values: { name } })}
    help={$t('upload.focus.help')}
    position={(values) => $t('upload.focus.position', { values })} />
  {#if failed}
    <FormError message={error || 'upload.focus.failed'} />
  {/if}
  <OfflineNote {online} />
  <div class="button-row button-row--end">
    <button
      type="button"
      class="button"
      disabled={busy}
      onclick={onClose}>
      {$t('common.cancel')}
    </button>
    {#if start}
      <button
        type="button"
        class="button"
        disabled={busy || !online}
        onclick={() => void save(null)}>
        {$t('upload.focus.reset')}
      </button>
    {/if}
    <button
      type="button"
      class="button button--primary"
      disabled={!image || busy || !online}
      onclick={() => void save(frameFocus(frame, size))}>
      {$t('upload.focus.save')}
    </button>
  </div>
</ModalShell>
