<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { t } from '../../lib/i18n';
  import type { AccountLinkInput } from '../../lib/api/inputs';
  import FormError from '../common/FormError.svelte';
  import TermsView from '../legal/TermsView.svelte';
  import ModalShell from '../ui/ModalShell.svelte';
  import { newPasswordProblem } from '../../lib/api/password-change';
  import type { MessageKey } from '../../lib/i18n/messages';
  interface Props {
    /**
     * From the route (mount one instance per token so drafts never carry over), or 'setup': the password step of a
     * mail-free registration, which starts at the activation fields with the name typed at sign-up.
     */
    kind: 'reset' | 'verify' | 'login' | 'setup';
    /** The display name to start from ('setup'). */
    initialName?: string;
    /** The address the new password belongs to, when the app knows it ('setup'): a hidden username field for password managers. */
    email?: string;
    online: boolean;
    /** The failed confirmation, from the app's form error. */
    error: string;
    /** Leaves without using the token. */
    onClose: () => void;
    /**
     * Confirms with the host's token. 'used' means the token is spent (a link route was replaced, so it left
     * history); 'activation' asks for a password and name first.
     */
    onConfirm: (input?: AccountLinkInput) => Promise<'used' | 'activation' | 'failed'>;
    /** Fetches the operator's contact address for the terms, when the reader asks for it. */
    loadContact: () => Promise<string>;
  }
  let { kind, initialName = '', email, online, error: serverError, onClose, onConfirm, loadContact }: Props = $props();
  let password = $state('');
  let confirmation = $state('');
  // Per instance: a host mounts a new one for another token or setup.
  let activationRequired = $state(untrack(() => kind === 'setup'));
  let displayName = $state(untrack(() => initialName));
  let nameInput = $state<HTMLInputElement>();
  let passwordInput = $state<HTMLInputElement>();
  /** The activation is the consent (whoever registered may not own the mailbox): terms required, error reports off unless ticked. */
  let termsAccepted = $state(false);
  let diagnosticsOptIn = $state(false);
  let termsOpen = $state(false);
  $effect(() => {
    // The setup step already has the name from sign-up: start at the password.
    if (activationRequired) (kind === 'setup' ? passwordInput : nameInput)?.focus();
  });
  const title = $derived(
    kind === 'setup'
      ? $t('account.link.setupTitle')
      : kind === 'login'
        ? $t('account.emailLink')
        : kind === 'reset'
          ? $t('account.resetPassword')
          : $t('account.link.verifyTitle'),
  );
  let busy = $state(false);
  /** Refused before sending: the confirmation differs, or the password passes bcrypt's 72 bytes (the server checks the same). */
  let problem = $state<MessageKey | ''>('');
  async function submit() {
    if (busy || !online) return;
    problem = (kind === 'reset' || activationRequired ? newPasswordProblem(password, confirmation) : null) ?? '';
    if (problem) return;
    if (activationRequired && !termsAccepted) return;
    busy = true;
    try {
      const input = activationRequired ? { password, displayName, termsAccepted, diagnosticsOptIn } : kind === 'reset' ? { password } : undefined;
      const result = await onConfirm(input);
      if (result === 'activation') activationRequired = true;
      else if (result === 'used') {
        password = '';
        confirmation = '';
        displayName = '';
      }
    } finally {
      busy = false;
    }
  }

  /** The link under the error-report choice: opens the terms at their error-report section. */
  async function showDiagnosticsTerms() {
    termsOpen = true;
    await tick();
    document.getElementById('terms-diagnostics')?.scrollIntoView({ block: 'start' });
  }
</script>

<!-- A sheet on phones: the activation's terms and boxes need the width (long words at 320 px). -->
<ModalShell
  {title}
  sheet
  onClose={() => {
    if (!busy) onClose();
  }}>
  <div class="account-link">
    <FormError message={problem || serverError} />
    <form
      onsubmit={(event) => {
        event.preventDefault();
        void submit();
      }}>
      {#if activationRequired}
        <p>{kind === 'setup' ? $t('account.link.setupBody') : $t('account.link.activationBody')}</p>
        <label class="form-field">
          {$t('auth.name')}
          <input
            class="form-field__control"
            bind:value={displayName}
            bind:this={nameInput}
            autocomplete="nickname"
            maxlength="100"
            required
            disabled={busy || !online} />
        </label>
      {/if}
      {#if kind === 'reset' || activationRequired}
        {#if email}
          <!-- Tells password managers which account the new password belongs to. -->
          <input
            type="email"
            name="username"
            autocomplete="username"
            value={email}
            readonly
            hidden />
        {/if}
        <label class="form-field">
          {$t('account.link.newPassword')}
          <input
            class="form-field__control"
            type="password"
            bind:value={password}
            bind:this={passwordInput}
            autocomplete="new-password"
            minlength="8"
            maxlength="128"
            disabled={busy || !online}
            required />
        </label>
        <label class="form-field">
          {$t('account.link.confirmPassword')}
          <input
            class="form-field__control"
            type="password"
            bind:value={confirmation}
            autocomplete="new-password"
            minlength="8"
            maxlength="128"
            disabled={busy || !online}
            required />
        </label>
      {:else}
        <p>
          {kind === 'login' ? $t('account.link.loginBody') : $t('account.link.verifyBody')}
        </p>
      {/if}
      {#if activationRequired}
        <details
          class="account-link__terms"
          bind:open={termsOpen}>
          <summary class="account-link__terms-summary">{$t('auth.terms.read')}</summary>
          <TermsView {loadContact} />
        </details>
        <label class="account-link__check">
          <input
            type="checkbox"
            name="termsAccepted"
            bind:checked={termsAccepted}
            required
            disabled={busy || !online} />
          <span>{$t('auth.terms.accept')}</span>
        </label>
        <label class="account-link__check account-link__diagnostics">
          <input
            type="checkbox"
            name="diagnosticsOptIn"
            bind:checked={diagnosticsOptIn}
            disabled={busy || !online} />
          <span>{$t('account.link.diagnostics')}</span>
        </label>
        <p class="account-link__more">
          <button
            type="button"
            class="account-link__link"
            onclick={showDiagnosticsTerms}>
            {$t('auth.diagnostics.link')}
          </button>
        </p>
      {/if}
      <button
        class="button button--primary"
        disabled={busy || !online || (activationRequired && !termsAccepted)}>
        {activationRequired
          ? $t('account.link.activate')
          : kind === 'login'
            ? $t('common.signIn')
            : kind === 'reset'
              ? $t('account.link.savePassword')
              : $t('account.link.verifyTitle')}
      </button>
    </form>
  </div>
</ModalShell>

<style>
  .account-link__terms {
    margin-bottom: var(--space-4);
  }
  .account-link__terms-summary {
    color: var(--accent);
    cursor: pointer;
    font-size: var(--font-sm);
  }
  .account-link__check {
    display: flex;
    align-items: start;
    gap: var(--space-2);
    margin-bottom: var(--space-4);
    font-size: var(--font-sm);
    line-height: 1.5;
  }
  .account-link__diagnostics {
    margin-bottom: var(--space-1);
  }
  .account-link__more {
    margin: 0 0 var(--space-4);
    font-size: var(--font-sm);
  }
  .account-link__link {
    border: 0;
    background: none;
    padding: 0;
    color: var(--accent);
    font: inherit;
    text-decoration: underline;
    cursor: pointer;
  }
  @media (pointer: coarse) {
    .account-link__terms-summary {
      display: flex;
      align-items: center;
      min-height: var(--touch-target);
    }
    .account-link__check {
      align-items: center;
      min-height: var(--touch-target);
    }
    .account-link__link {
      min-height: var(--touch-target);
    }
  }
</style>
