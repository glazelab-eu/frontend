<script lang="ts">
  import { t } from '../../lib/i18n';
  import { FIRST_FIELD } from '../ui/first-field';
  import ModalShell from '../ui/ModalShell.svelte';
  import FormError from '../common/FormError.svelte';

  interface Props {
    email: string;
    online: boolean;
    error: string;
    onConfirm: (password: string) => Promise<boolean>;
    onClose: () => void;
  }
  let { email, online, error, onConfirm, onClose }: Props = $props();
  let password = $state('');
  let confirmed = $state(false);
  let busy = $state(false);
  async function remove() {
    if (!online || busy || !password || !confirmed) return;
    busy = true;
    try {
      if (await onConfirm(password)) onClose();
    } finally {
      busy = false;
    }
  }
</script>

<ModalShell
  title={$t('account.delete.title')}
  initialFocus={FIRST_FIELD}
  onClose={() => {
    if (!busy) onClose();
  }}>
  <p>{$t('account.delete.body', { values: { email } })}</p>
  <p>{$t('account.delete.shared')}</p>
  <p>{$t('account.delete.clubs')}</p>
  <form
    onsubmit={(event) => {
      event.preventDefault();
      void remove();
    }}>
    <label class="form-field">
      {$t('auth.password')}
      <input
        class="form-field__control"
        type="password"
        autocomplete="current-password"
        bind:value={password}
        maxlength="128"
        required
        disabled={busy || !online} />
    </label>
    <label class="delete-account__confirmation">
      <input
        type="checkbox"
        bind:checked={confirmed}
        required
        disabled={busy || !online} />
      <span>{$t('account.delete.understand')}</span>
    </label>
    <FormError message={error} />
    <div class="button-row button-row--end">
      <button
        type="button"
        class="button"
        disabled={busy}
        onclick={onClose}>
        {$t('account.delete.cancel')}
      </button>
      <button
        class="button button--danger"
        disabled={!online || busy || !password || !confirmed}>
        {$t('account.delete.confirm')}
      </button>
    </div>
  </form>
</ModalShell>

<style>
  .delete-account__confirmation {
    display: flex;
    align-items: start;
    gap: var(--space-2);
    margin: var(--space-4) 0;
    font-size: var(--font-sm);
  }
  @media (pointer: coarse) {
    .delete-account__confirmation {
      align-items: center;
      min-height: var(--touch-target);
    }
  }
</style>
