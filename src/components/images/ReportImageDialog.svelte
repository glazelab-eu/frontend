<script lang="ts">
  import { t } from '../../lib/i18n';
  import { MAX_REPORT_REASON, reportReason } from '../../lib/images/photo-menu';
  import { pictureFocusFallback } from '../../lib/images/picture-focus';
  import FormError from '../common/FormError.svelte';
  import ModalShell from '../ui/ModalShell.svelte';
  import OfflineNote from '../common/OfflineNote.svelte';

  interface Props {
    online: boolean;
    /** The dialog's heading and explanation; the photo report's own words unless a profile picture's are given (31-3). */
    title?: string;
    body?: string;
    /** Why the last report failed, shown at the submit button. */
    error?: string;
    /** Resolves true once the report was recorded (a repeated report counts). */
    onSubmit: (reason: string | null) => Promise<boolean>;
    onClose: () => void;
  }

  let { online, title, body, error = '', onSubmit, onClose }: Props = $props();
  const id = $props.id();
  let text = $state('');
  let busy = $state(false);
  let failed = $state(false);
  const focusCard = pictureFocusFallback();

  async function submit() {
    if (busy || !online) return;
    busy = true;
    failed = false;
    try {
      failed = !(await onSubmit(reportReason(text)));
      if (!failed) onClose();
    } finally {
      busy = false;
    }
  }
</script>

<ModalShell
  title={title ?? $t('images.report.title')}
  fallbackFocus={focusCard}
  onClose={() => !busy && onClose()}>
  <p>{body ?? $t('images.report.body')}</p>
  <form
    onsubmit={(event) => {
      event.preventDefault();
      void submit();
    }}>
    <label class="form-field">
      {$t('images.report.reason')}
      <textarea
        class="form-field__control form-field__control--multiline"
        bind:value={text}
        maxlength={MAX_REPORT_REASON}
        rows="4"
        aria-describedby="{id}-count">
      </textarea>
    </label>
    <small
      class="report-image__count"
      id="{id}-count">
      {$t('images.report.count', { values: { count: text.length, max: MAX_REPORT_REASON } })}
    </small>
    {#if failed}
      <FormError message={error || 'errors.generic'} />
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
        disabled={busy || !online}>
        {$t('images.report.submit')}
      </button>
    </div>
  </form>
</ModalShell>

<style>
  .report-image__count {
    display: block;
    margin: calc(-1 * var(--space-2)) 0 var(--space-3);
    color: var(--muted);
    font-size: var(--font-xs);
  }
  @media (pointer: coarse) {
    .report-image__count {
      font-size: var(--font-body);
    }
  }
</style>
