<script lang="ts">
  import { t } from '../../lib/i18n';
  import { MAX_UPLOAD_FILES, type Rejected, type Rejection } from '../../lib/images/upload-queue';

  interface Props {
    /** The files chosen in one go (library or camera). */
    onFiles: (files: File[]) => void;
    /** The files of the last choice that were not added, each named with its reason. */
    rejected: readonly Rejected[];
    disabled?: boolean;
  }

  let { onFiles, rejected, disabled = false }: Props = $props();

  const reasons: Record<Rejection, () => string> = {
    empty: () => $t('upload.reason.empty'),
    notImage: () => $t('upload.reason.notImage'),
    tooLarge: () => $t('errors.imageTooBig'),
    tooMany: () => $t('upload.reason.tooMany', { values: { count: MAX_UPLOAD_FILES } }),
    heic: () => $t('upload.reason.heic'),
  };

  function choose(event: Event & { currentTarget: HTMLInputElement }) {
    const input = event.currentTarget;
    onFiles([...(input.files ?? [])]);
    // The same file may be chosen again after it was removed.
    input.value = '';
  }
</script>

<!-- The inputs keep accept="image/*": an explicit image/heic makes iOS hand over HEIC originals (upload topic). -->
<div class="button-row">
  <label class={['button', 'upload-picker__pick', { 'upload-picker__pick--disabled': disabled }]}>
    {$t('upload.library')}
    <input
      class="upload-picker__input"
      type="file"
      accept="image/*"
      multiple
      {disabled}
      onchange={choose} />
  </label>
  <label class={['button', 'upload-picker__pick', 'upload-picker__pick--camera', { 'upload-picker__pick--disabled': disabled }]}>
    {$t('upload.camera')}
    <input
      class="upload-picker__input"
      type="file"
      accept="image/*"
      capture="environment"
      {disabled}
      onchange={choose} />
  </label>
</div>
<p class="upload-picker__hint">{$t('upload.limits', { values: { count: MAX_UPLOAD_FILES } })}</p>
{#each rejected as item}
  <p
    class="upload-picker__skipped"
    role="alert">
    {$t('upload.skipped', { values: { name: item.name, reason: reasons[item.reason]() } })}
  </p>
{/each}

<style>
  .upload-picker__pick {
    position: relative;
    display: inline-flex;
    align-items: center;
    cursor: pointer;
    white-space: normal;
    border-color: var(--control-border);
  }
  .upload-picker__pick:focus-within {
    outline: 0.125rem solid var(--accent);
    outline-offset: 0.125rem;
  }
  .upload-picker__pick--disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .upload-picker__pick--camera {
    display: none;
  }
  @media (width < 45em) {
    .upload-picker__pick--camera {
      display: inline-flex;
    }
  }
  .upload-picker__input {
    position: absolute;
    inset: 0;
    inline-size: 100%;
    block-size: 100%;
    opacity: 0;
    cursor: pointer;
    font-size: 0;
  }
  .upload-picker__input:disabled {
    cursor: not-allowed;
  }
  .upload-picker__hint {
    color: var(--muted);
    line-height: 1.5;
    margin: var(--space-2) 0 var(--space-4);
    font-size: var(--font-xs);
  }
  .upload-picker__skipped {
    margin: 0 0 var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--danger-bg);
    color: var(--danger-ink);
    font-size: var(--font-sm);
    overflow-wrap: anywhere;
  }
  @media (pointer: coarse) {
    .upload-picker__hint {
      font-size: var(--font-body);
    }
  }
</style>
