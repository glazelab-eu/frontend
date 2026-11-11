<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { t } from '../../lib/i18n';
  import type { Glaze } from '../../lib/api/models';
  import { suggestLabel, type LabelSuggestion } from '../../lib/ocr/label';
  import { PhotoError, validatePhoto } from '../../lib/ocr/photo';
  import { codeMaxLength, normalizeCode } from '../../lib/glazes/glaze-form';
  import ModalShell from '../ui/ModalShell.svelte';
  import FormError from '../common/FormError.svelte';
  import { reloadApp } from '../../lib/pwa/update';

  interface Props {
    glazes: Glaze[];
    initial: LabelSuggestion;
    onConfirm: (suggestion: LabelSuggestion) => void;
    onClose: () => void;
  }
  let { glazes, initial, onConfirm, onClose }: Props = $props();
  let photo = $state<File | null>(null);
  let preview = $state('');
  let suggestion = $state<LabelSuggestion>({ manufacturer: '', name: '', code: '' });
  let status = $state<'idle' | 'reading' | 'review' | 'load' | 'failed'>('idle');
  let error = $state('');
  let capture = $state<HTMLInputElement>();
  let library = $state<HTMLInputElement>();
  let review = $state<HTMLElement>();
  let scan: AbortController | null = null;
  let empty = $state(false);

  function release() {
    scan?.abort();
    scan = null;
    if (preview) URL.revokeObjectURL(preview);
    preview = '';
  }
  onMount(() => release);
  function close() {
    release();
    onClose();
  }

  async function read(file: File) {
    release();
    error = '';
    photo = file;
    status = 'idle';
    try {
      validatePhoto(file);
    } catch (cause) {
      if (cause instanceof PhotoError) error = cause.problem === 'fileType' ? 'ocr.errors.fileType' : 'ocr.errors.fileSize';
      return;
    }
    preview = URL.createObjectURL(file);
    status = 'reading';
    const current = new AbortController();
    scan = current;
    let reader: typeof import('../../lib/ocr/label-reader');
    try {
      reader = await import('../../lib/ocr/label-reader');
    } catch {
      if (!current.signal.aborted) {
        status = 'load';
        error = 'ocr.errors.load';
      }
      return;
    }
    if (current.signal.aborted) return;
    try {
      const text = await reader.readPhoto(file, current.signal);
      if (current.signal.aborted) return;
      const found = suggestLabel(text, glazes);
      empty = !found.code && !found.name;
      suggestion = {
        manufacturer: found.manufacturer || initial.manufacturer,
        name: found.name || initial.name,
        code: found.code || initial.code,
      };
      status = 'review';
      await tick();
      review?.focus();
    } catch (cause) {
      if (current.signal.aborted) return;
      status = 'failed';
      const problem = cause instanceof Error && 'problem' in cause ? cause.problem : 'failed';
      error =
        problem === 'pixels'
          ? 'ocr.errors.pixels'
          : problem === 'image'
            ? 'ocr.errors.image'
            : problem === 'timeout'
              ? 'ocr.errors.timeout'
              : problem === 'unsupported'
                ? 'ocr.errors.unsupported'
                : 'ocr.errors.failed';
    }
  }

  function chosen(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) void read(file);
  }
</script>

<ModalShell
  title={$t('ocr.title')}
  onClose={close}>
  <div class="label-scanner">
    {#if status !== 'review'}
      <p class="label-scanner__intro">{$t('ocr.intro')}</p>
      <p class="label-scanner__hint">{$t('ocr.download')}</p>
    {/if}
    <input
      bind:this={capture}
      type="file"
      accept="image/jpeg,image/png,image/webp"
      capture="environment"
      hidden
      onchange={chosen} />
    <input
      bind:this={library}
      type="file"
      accept="image/jpeg,image/png,image/webp"
      hidden
      onchange={chosen} />
    <div class="button-row label-scanner__choices">
      <button
        type="button"
        class="button"
        onclick={() => capture?.click()}>
        {$t('ocr.takePhoto')}
      </button>
      <button
        type="button"
        class="button"
        onclick={() => library?.click()}>
        {$t('ocr.choosePhoto')}
      </button>
    </div>
    {#if preview}
      <img
        class="label-scanner__photo"
        src={preview}
        alt={$t('ocr.photoAlt')} />
    {/if}
    {#if status === 'reading'}
      <p role="status">{$t('ocr.reading')}</p>
    {/if}
    <FormError message={error} />
    {#if status === 'load'}
      <button
        type="button"
        class="button"
        onclick={() => reloadApp()}>
        {$t('route.reload')}
      </button>
    {:else if status === 'failed' && photo}
      <button
        type="button"
        class="button"
        onclick={() => photo && read(photo)}>
        {$t('common.tryAgain')}
      </button>
    {/if}
    {#if status === 'review'}
      <form
        class="label-scanner__review"
        onsubmit={(event) => {
          event.preventDefault();
          onConfirm({
            manufacturer: suggestion.manufacturer.trim(),
            name: suggestion.name.trim(),
            code: normalizeCode(suggestion.code),
          });
          close();
        }}>
        <h3
          bind:this={review}
          tabindex="-1">
          {$t('ocr.review')}
        </h3>
        <p class="label-scanner__hint">{empty ? $t('ocr.empty') : $t('ocr.check')}</p>
        <label class="form-field">
          {$t('glazeForm.manufacturer')}
          <input
            class="form-field__control"
            bind:value={suggestion.manufacturer}
            maxlength="100"
            required />
        </label>
        <label class="form-field">
          {$t('stock.newGlaze.name')}
          <input
            class="form-field__control"
            bind:value={suggestion.name}
            maxlength="120"
            required />
        </label>
        <label class="form-field">
          {$t('stock.newGlaze.code')}
          <input
            class="form-field__control"
            bind:value={suggestion.code}
            maxlength={codeMaxLength * 2}
            required />
        </label>
        <button class="button button--primary">{$t('ocr.confirm')}</button>
      </form>
    {/if}
    <button
      type="button"
      class="button label-scanner__cancel"
      onclick={close}>
      {$t('ocr.cancel')}
    </button>
  </div>
</ModalShell>

<style>
  .label-scanner__intro {
    margin-bottom: var(--space-2);
  }
  .label-scanner__hint {
    color: var(--muted);
    font-size: var(--font-sm);
    margin-bottom: var(--space-4);
  }
  .label-scanner__choices {
    margin-bottom: var(--space-4);
  }
  .label-scanner__photo {
    display: block;
    width: 100%;
    max-height: 18rem;
    object-fit: contain;
    border-radius: var(--radius-sm);
    margin-bottom: var(--space-4);
  }
  .label-scanner__review {
    margin-top: var(--space-4);
  }
  .label-scanner__cancel {
    margin-top: var(--space-4);
  }
  @media (width < 45em) {
    .label-scanner__photo {
      max-height: 10rem;
    }
  }
</style>
