<script lang="ts">
  import TermsView from '../legal/TermsView.svelte';
  import AccountRecovery from './AccountRecovery.svelte';
  import { t } from '../../lib/i18n';
  import FormError from '../common/FormError.svelte';
  import { FIRST_FIELD } from '../ui/first-field';
  import ModalShell from '../ui/ModalShell.svelte';
  import type { AuthOptions } from '../../lib/api/models';
  import type { AuthInput } from '../../lib/api/inputs';

  interface Props {
    online: boolean;
    /** Why the dialog opened by itself: the server ended the session (`sessionEndedKept`: and input on the page waits for the same account). */
    notice?: 'sessionEnded' | 'sessionEndedKept' | null;
    /** The app's public sign-in options: undefined while they load, null when they could not be loaded. */
    options: AuthOptions | null | undefined;
    /** The failed sign-in or registration, from the app's form error. */
    error: string;
    /** The failed recovery request, from the app's form error. */
    recoveryError: string;
    onClose: () => void;
    /** Fetches the operator's contact address for the terms, when the reader asks for it. */
    loadContact: () => Promise<string>;
    /** 'mail': registered, and the server emailed the link for the password (the dialog says so). */
    onSubmit: (input: AuthInput) => Promise<'done' | 'mail' | 'failed'>;
    onRequestMail: (kind: 'reset' | 'verify' | 'login', email: string) => Promise<boolean>;
    onClearError: () => void;
  }

  let { online, notice = null, options, error, recoveryError, onClose, loadContact, onSubmit, onRequestMail, onClearError }: Props = $props();
  let mode = $state<AuthInput['mode']>('login');
  let email = $state('');
  let password = $state('');
  let displayName = $state('');
  let busy = $state(false);
  const emailEnabled = $derived(options?.emailEnabled ?? false);
  let recovery = $state<'reset' | 'verify' | 'login' | null>(null);
  /** The address a registration link was emailed to: the dialog then says to check the inbox. */
  let sentTo = $state('');

  async function submit() {
    if (busy || !online) return;
    busy = true;
    try {
      const result = await onSubmit(mode === 'register' ? { mode, email, displayName } : { mode, email, password });
      if (result === 'mail') sentTo = email;
    } finally {
      busy = false;
    }
  }

  function backToSignIn() {
    sentTo = '';
    mode = 'login';
    onClearError();
  }

  function toggleMode() {
    mode = mode === 'login' ? 'register' : 'login';
    onClearError();
  }
</script>

<ModalShell
  ariaLabel={$t('auth.dialogLabel')}
  initialFocus={FIRST_FIELD}
  {onClose}>
  {#if recovery}
    <AccountRecovery
      kind={recovery}
      initialEmail={sentTo}
      {online}
      error={recoveryError}
      onRequest={onRequestMail}
      onBack={() => {
        recovery = null;
        onClearError();
      }} />
  {:else if sentTo}
    <div class="auth-dialog">
      <div class="eyebrow">{$t('auth.eyebrow')}</div>
      <h2 class="auth-dialog__title">{$t('auth.checkEmail.title')}</h2>
      <p
        class="auth-dialog__sent"
        role="status">
        {$t('auth.checkEmail.body', { values: { email: sentTo } })}
      </p>
      <button
        class="button auth-dialog__submit"
        onclick={() => (recovery = 'verify')}>
        {$t('account.resendVerification')}
      </button>
      <button
        class="auth-dialog__switch"
        onclick={backToSignIn}>
        {$t('account.recovery.back')}
      </button>
    </div>
  {:else}
    <div class="auth-dialog">
      <div class="eyebrow">{$t('auth.eyebrow')}</div>
      <h2 class="auth-dialog__title">
        {mode === 'login' ? $t('auth.signIn.title') : $t('auth.register.title')}
      </h2>
      {#if notice}
        <p
          class="auth-dialog__notice"
          role="alert">
          {$t(notice === 'sessionEndedKept' ? 'auth.sessionEndedKept' : 'auth.sessionEnded')}
        </p>
      {/if}
      <p class="auth-dialog__description">
        {mode === 'login' ? $t('auth.signIn.body') : $t('auth.register.body')}
      </p>
      {#if mode === 'register'}
        <p class="auth-dialog__description">
          {emailEnabled ? $t('auth.register.verification') : $t('auth.register.passwordNext')}
        </p>
      {/if}
      <form
        onsubmit={(event) => {
          event.preventDefault();
          void submit();
        }}>
        {#if mode === 'register'}
          <label class="form-field">
            {$t('auth.name')}
            <input
              class="form-field__control"
              type="text"
              name="displayName"
              bind:value={displayName}
              required
              maxlength="100"
              autocomplete="nickname" />
          </label>
        {/if}
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
        {#if mode === 'login'}
          <label class="form-field">
            {$t('auth.password')}
            <input
              class="form-field__control"
              type="password"
              bind:value={password}
              required
              maxlength="128"
              autocomplete="current-password" />
          </label>
        {/if}
        {#if mode === 'register'}
          <!-- Information only: the mailbox owner accepts the terms when activating the account (REVIEW-4). -->
          <details class="auth-dialog__terms">
            <summary class="auth-dialog__terms-summary">{$t('auth.terms.read')}</summary>
            <TermsView {loadContact} />
          </details>
          <p class="auth-dialog__terms-notice">{$t('auth.terms.atActivation')}</p>
        {/if}
        <FormError message={error} />
        <button
          class="button auth-dialog__submit button--primary"
          disabled={busy || !online}>
          {mode === 'login' ? $t('common.signIn') : $t('auth.register.submit')}
        </button>
      </form>
      {#if mode === 'login' && emailEnabled}
        <button
          class="auth-dialog__switch"
          onclick={() => (recovery = 'login')}
          disabled={busy}>
          {$t('account.emailLink')}
        </button>
        <button
          class="auth-dialog__switch"
          onclick={() => (recovery = 'reset')}
          disabled={busy}>
          {$t('auth.forgotPassword')}
        </button>
        <button
          class="auth-dialog__switch"
          onclick={() => (recovery = 'verify')}
          disabled={busy}>
          {$t('account.resendVerification')}
        </button>
      {/if}
      <button
        class="auth-dialog__switch"
        onclick={toggleMode}
        disabled={busy}>
        {mode === 'login' ? $t('auth.register.switch') : $t('auth.signIn.switch')}
      </button>
    </div>
  {/if}
</ModalShell>

<style>
  .auth-dialog__terms {
    margin-bottom: var(--space-4);
  }
  .auth-dialog__terms-summary {
    color: var(--accent);
    cursor: pointer;
    font-size: var(--font-sm);
  }
  .auth-dialog__terms-notice {
    color: var(--muted);
    font-size: var(--font-sm);
    margin-bottom: var(--space-4);
  }
  /* The dialog heading look of `ui/ModalShell` (its title changes with the step while the dialog's name stays). */
  .auth-dialog__title {
    font-size: var(--font-lg);
    font-weight: 600;
    margin: var(--space-3) 0 var(--space-1);
  }
  .auth-dialog__notice {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--warning-bg);
    color: var(--warning-ink);
    font-size: var(--font-sm);
    line-height: 1.5;
    margin-bottom: var(--space-4);
  }
  .auth-dialog__description {
    font-size: var(--font-xs);
    color: var(--muted);
    line-height: 1.5;
    margin-bottom: var(--space-6);
  }
  .auth-dialog__sent {
    line-height: 1.5;
    margin-bottom: var(--space-6);
  }
  .auth-dialog__submit {
    width: 100%;
    margin-top: var(--space-1);
  }

  .auth-dialog__switch {
    border: 0;
    background: none;
    color: var(--accent);
    font-size: var(--font-sm);
    font-weight: 700;
    display: block;
    margin: var(--space-5) auto 0;
  }
  @media (pointer: coarse) {
    .auth-dialog__terms-summary {
      display: flex;
      align-items: center;
      min-height: var(--touch-target);
    }
    .auth-dialog__switch {
      min-width: var(--touch-target);
      min-height: var(--touch-target);
    }
    .auth-dialog__description {
      font-size: var(--font-body);
    }
  }
</style>
