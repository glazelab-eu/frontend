<script lang="ts">
  import { untrack } from 'svelte';
  import { t } from '../../lib/i18n';
  import FormError from '../common/FormError.svelte';
  interface Props {
    kind: 'reset' | 'verify' | 'login';
    /** The address to start from (the one just registered). */
    initialEmail?: string;
    online: boolean;
    /** The failed request, from the app's form error. */
    error: string;
    onBack: () => void;
    /** Asks for the email; false after a failure. */
    onRequest: (kind: 'reset' | 'verify' | 'login', email: string) => Promise<boolean>;
  }
  let { kind, initialEmail = '', online, error, onBack, onRequest }: Props = $props();
  let email = $state(untrack(() => initialEmail));
  let busy = $state(false);
  let sent = $state(false);
  async function submit() {
    if (busy || !online) return;
    busy = true;
    try {
      sent = await onRequest(kind, email);
    } finally {
      busy = false;
    }
  }
</script>

<h2 class="account-recovery__title">
  {kind === 'login' ? $t('account.emailLink') : kind === 'reset' ? $t('account.resetPassword') : $t('account.resendVerification')}
</h2>
<FormError message={error} />
{#if sent}
  <p role="status">
    {$t('account.recovery.sent')}
  </p>
{:else}
  <form
    onsubmit={(event) => {
      event.preventDefault();
      void submit();
    }}>
    <label class="form-field">
      {$t('common.email')}
      <input
        class="form-field__control"
        type="email"
        bind:value={email}
        required
        maxlength="255"
        autocomplete="email" />
    </label>
    <button
      class="button button--primary"
      disabled={busy || !online}>
      {$t('account.recovery.send')}
    </button>
  </form>
{/if}
<button
  class="button account-recovery__back"
  onclick={onBack}
  disabled={busy}>
  {$t('account.recovery.back')}
</button>

<style>
  /* The dialog heading look of `ui/ModalShell`: this step of the sign-in dialog brings its own heading. */
  .account-recovery__title {
    margin: 0 0 var(--space-3);
    padding-inline-end: var(--space-4);
    font-size: var(--font-lg);
    font-weight: 600;
  }
  .account-recovery__back {
    margin-top: var(--space-4);
  }
</style>
