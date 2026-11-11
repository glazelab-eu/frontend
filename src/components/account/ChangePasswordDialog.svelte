<script lang="ts">
  import { t, type MessageKey } from '../../lib/i18n';
  import { FIRST_FIELD } from '../ui/first-field';
  import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, passwordChangeProblem } from '../../lib/api/password-change';
  import FormError from '../common/FormError.svelte';
  import ModalShell from '../ui/ModalShell.svelte';
  import OfflineNote from '../common/OfflineNote.svelte';

  interface Props {
    /** The signed-in address, for password managers (a hidden username field) and the explanation. */
    email: string;
    online: boolean;
    /** The failed change, from the app's form error. */
    error: string;
    /** Sends the change; true closes the dialog (the host does) and shows the notice. */
    onConfirm: (currentPassword: string, newPassword: string) => Promise<boolean>;
    onClose: () => void;
  }
  let { email, online, error: serverError, onConfirm, onClose }: Props = $props();
  let current = $state('');
  let next = $state('');
  let confirmation = $state('');
  /** A refusal found before sending (mismatch, unchanged, too long); cleared by the next submit. */
  let problem = $state<MessageKey | ''>('');
  let busy = $state(false);

  async function submit() {
    if (busy || !online) return;
    problem = passwordChangeProblem({ current, next, confirmation }) ?? '';
    if (problem) return;
    busy = true;
    try {
      if (await onConfirm(current, next)) {
        current = '';
        next = '';
        confirmation = '';
      }
    } finally {
      busy = false;
    }
  }
</script>

<ModalShell
  title={$t('account.password.title')}
  initialFocus={FIRST_FIELD}
  onClose={() => {
    if (!busy) onClose();
  }}>
  <p>{$t('account.password.body', { values: { email } })}</p>
  <FormError message={problem || serverError} />
  <form
    class="change-password"
    onsubmit={(event) => {
      event.preventDefault();
      void submit();
    }}>
    <!-- Tells password managers which account the new password belongs to. -->
    <input
      type="email"
      name="username"
      autocomplete="username"
      value={email}
      readonly
      hidden />
    <label class="form-field">
      {$t('account.password.current')}
      <input
        class="form-field__control"
        type="password"
        name="current-password"
        autocomplete="current-password"
        bind:value={current}
        maxlength={PASSWORD_MAX_LENGTH}
        required
        disabled={busy || !online} />
    </label>
    <label class="form-field">
      {$t('account.password.new')}
      <input
        class="form-field__control"
        type="password"
        name="new-password"
        autocomplete="new-password"
        bind:value={next}
        minlength={PASSWORD_MIN_LENGTH}
        maxlength={PASSWORD_MAX_LENGTH}
        required
        disabled={busy || !online} />
      <!-- Inside the label, so it is part of the field's name, as the glaze form's hints are. -->
      <small class="change-password__hint">{$t('account.password.hint', { values: { min: PASSWORD_MIN_LENGTH } })}</small>
    </label>
    <label class="form-field">
      {$t('account.password.confirm')}
      <input
        class="form-field__control"
        type="password"
        name="confirm-password"
        autocomplete="new-password"
        bind:value={confirmation}
        minlength={PASSWORD_MIN_LENGTH}
        maxlength={PASSWORD_MAX_LENGTH}
        required
        disabled={busy || !online} />
    </label>
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
        {$t('account.password.save')}
      </button>
    </div>
  </form>
</ModalShell>

<style>
  .change-password__hint {
    display: block;
    margin-top: var(--space-1);
    font-weight: 400;
    color: var(--muted);
    font-size: var(--font-sm);
  }
</style>
