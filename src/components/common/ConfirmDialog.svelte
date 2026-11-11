<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from '../../lib/i18n';
  import ModalShell from '../ui/ModalShell.svelte';
  import FormError from './FormError.svelte';
  import OfflineNote from './OfflineNote.svelte';

  interface Props {
    /** The question: the dialog's heading and its accessible name. */
    title: string;
    confirmLabel: string;
    /** A destructive confirm is `.button--danger`, else `.button--primary`. */
    danger?: boolean;
    /** Offline the confirm is disabled and the offline note stands above it. */
    online?: boolean;
    /** What the offline note says; by default `forms.offline`. */
    offlineMessage?: string;
    /** The confirmed action runs: both buttons wait and the dialog does not close. */
    busy?: boolean;
    /** The confirm cannot be pressed for a reason the body states. */
    confirmDisabled?: boolean;
    /** Why the last confirm failed (a server message or key), shown and focused above the buttons. */
    error?: string;
    onConfirm: () => void;
    onCancel: () => void;
    /** Used when a completed action removes the button that opened this dialog. */
    fallbackFocus?: () => void;
    children: Snippet;
  }

  let {
    title,
    confirmLabel,
    danger = true,
    online = true,
    offlineMessage,
    busy = false,
    confirmDisabled = false,
    error = '',
    onConfirm,
    onCancel,
    fallbackFocus,
    children,
  }: Props = $props();
  const cancel = () => {
    if (!busy) onCancel();
  };
</script>

<ModalShell
  {title}
  onClose={cancel}
  {fallbackFocus}>
  {@render children()}
  <FormError message={error} />
  <OfflineNote
    {online}
    message={offlineMessage} />
  <!-- The safe action first, the destructive one last. -->
  <div class="button-row button-row--end">
    <button
      type="button"
      class="button"
      disabled={busy}
      onclick={cancel}>
      {$t('common.cancel')}
    </button>
    <button
      type="button"
      class={['button', danger ? 'button--danger' : 'button--primary']}
      aria-busy={busy || undefined}
      disabled={busy || confirmDisabled || !online}
      onclick={() => {
        if (!busy && !confirmDisabled && online) onConfirm();
      }}>
      {confirmLabel}
    </button>
  </div>
</ModalShell>
