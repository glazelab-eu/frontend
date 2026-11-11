<script lang="ts">
  import { t } from '../../lib/i18n';
  import ModalShell from '../ui/ModalShell.svelte';
  import FormError from '../common/FormError.svelte';
  import TermsView from './TermsView.svelte';

  interface Props {
    online: boolean;
    error: string;
    loadContact: () => Promise<string>;
    onAccept: () => Promise<boolean>;
    onLogout: () => void;
    onDeleteAccount: () => void;
  }

  let { online, error, loadContact, onAccept, onLogout, onDeleteAccount }: Props = $props();
  let accepted = $state(false);
  let busy = $state(false);

  async function accept() {
    if (busy || !online || !accepted) return;
    busy = true;
    try {
      await onAccept();
    } finally {
      busy = false;
    }
  }
</script>

<!-- Blocking: the account can read, but writes wait until the current terms are accepted. -->
<ModalShell
  topmost
  title={$t('terms.update.title')}
  eyebrow={$t('terms.title')}>
  <p class="terms-dialog__description">{$t('terms.update.body')}</p>
  <details class="terms-dialog__terms">
    <summary class="terms-dialog__summary">{$t('auth.terms.read')}</summary>
    <TermsView {loadContact} />
  </details>
  <form
    onsubmit={(event) => {
      event.preventDefault();
      void accept();
    }}>
    <label class="terms-dialog__accept">
      <input
        type="checkbox"
        bind:checked={accepted}
        required
        disabled={busy || !online} />
      <span>{$t('auth.terms.accept')}</span>
    </label>
    <FormError message={error} />
    <div class="button-row button-row--end">
      <button
        type="button"
        class="button"
        disabled={busy || !online}
        onclick={onDeleteAccount}>
        {$t('account.delete.title')}
      </button>
      <button
        type="button"
        class="button"
        disabled={busy}
        onclick={onLogout}>
        {$t('header.signOut')}
      </button>
      <button
        class="button button--primary"
        disabled={busy || !online || !accepted}>
        {$t('terms.update.accept')}
      </button>
    </div>
  </form>
</ModalShell>

<style>
  .terms-dialog__description {
    font-size: var(--font-sm);
    color: var(--muted);
    line-height: 1.5;
    margin-bottom: var(--space-4);
  }
  .terms-dialog__terms {
    margin-bottom: var(--space-4);
  }
  .terms-dialog__summary {
    color: var(--accent);
    cursor: pointer;
    font-size: var(--font-sm);
  }
  .terms-dialog__accept {
    display: flex;
    align-items: start;
    gap: var(--space-2);
    margin-bottom: var(--space-4);
    font-size: var(--font-sm);
    line-height: 1.5;
  }
  @media (pointer: coarse) {
    .terms-dialog__summary {
      display: flex;
      align-items: center;
      min-height: var(--touch-target);
    }
    .terms-dialog__accept {
      align-items: center;
      min-height: var(--touch-target);
    }
  }
</style>
