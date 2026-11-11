<script lang="ts">
  import { t } from '../../lib/i18n';
  import type { ImageInfo } from '../../lib/api/models';
  import type { ImageDetailsChange } from '../../lib/api/inputs';
  import { EARLIEST_FIRED_ON, LATEST_FIRED_ON, MAX_CAPTION, detailsChange, detailsDraft, type PhotoDetailsDraft } from '../../lib/images/photo-details';
  import { pictureFocusFallback } from '../../lib/images/picture-focus';
  import FormError from '../common/FormError.svelte';
  import ModalShell from '../ui/ModalShell.svelte';
  import OfflineNote from '../common/OfflineNote.svelte';

  interface Props {
    /** A picture the signed-in user uploaded. */
    image: ImageInfo;
    online: boolean;
    /** Why the last save failed, shown at the Save button. */
    error?: string;
    /** Resolves true once saved; the host keeps showing the photo, wherever its new order puts it. */
    onChange: (image: ImageInfo, change: ImageDetailsChange) => Promise<boolean>;
    onClose: () => void;
  }

  let { image, online, error = '', onChange, onClose }: Props = $props();
  const id = $props.id();
  // The form starts from the photo as it was when the dialog opened and keeps the writer's edits.
  // svelte-ignore state_referenced_locally
  let draft = $state<PhotoDetailsDraft>(detailsDraft(image));
  let change = $derived(detailsChange(image, draft));
  let busy = $state(false);
  let failed = $state(false);
  const focusCard = pictureFocusFallback();

  async function submit() {
    if (busy || !online || !change) return;
    busy = true;
    failed = false;
    try {
      failed = !(await onChange(image, change));
      if (!failed) onClose();
    } finally {
      busy = false;
    }
  }
</script>

<ModalShell
  title={$t('images.details.title')}
  fallbackFocus={focusCard}
  onClose={() => !busy && onClose()}>
  <form
    onsubmit={(event) => {
      event.preventDefault();
      void submit();
    }}>
    <label class="form-field">
      {$t('images.details.caption')}
      <input
        class="form-field__control"
        bind:value={draft.caption}
        maxlength={MAX_CAPTION}
        placeholder={$t('images.details.captionPlaceholder')}
        autocomplete="off"
        aria-describedby="{id}-count"
        disabled={busy || !online} />
    </label>
    <small
      class="picture-details__count"
      id="{id}-count">
      {$t('images.details.count', { values: { count: draft.caption.length, max: MAX_CAPTION } })}
    </small>
    <div class="form-field">
      <label for="{id}-fired-on">{$t('images.details.firedOn')}</label>
      <div class="picture-details__date">
        <input
          class="form-field__control picture-details__input"
          id="{id}-fired-on"
          type="date"
          min={EARLIEST_FIRED_ON}
          max={LATEST_FIRED_ON}
          bind:value={draft.firedOn}
          disabled={busy || !online} />
        {#if draft.firedOn}
          <button
            type="button"
            class="button"
            disabled={busy || !online}
            onclick={() => (draft.firedOn = '')}>
            {$t('images.details.clearDate')}
          </button>
        {/if}
      </div>
    </div>
    {#if failed}
      <FormError message={error || 'images.details.failed'} />
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
      <button
        class="button button--primary"
        disabled={busy || !online || !change}>
        {$t('images.details.save')}
      </button>
    </div>
  </form>
</ModalShell>

<style>
  .picture-details__count {
    display: block;
    margin: calc(-1 * var(--space-2)) 0 var(--space-3);
    color: var(--muted);
    font-size: var(--font-xs);
  }
  .picture-details__date {
    display: flex;
    align-items: end;
    gap: var(--space-2);
  }
  .picture-details__input {
    flex: 1 1 auto;
    min-width: 0;
  }
  @media (pointer: coarse) {
    .picture-details__count {
      font-size: var(--font-body);
    }
  }
</style>
