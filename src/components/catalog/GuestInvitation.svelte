<script lang="ts">
  import { t } from '../../lib/i18n';

  interface Props {
    /** What an account adds on this page. */
    message: string;
    onSignIn: () => void;
  }

  let { message, onSignIn }: Props = $props();
</script>

<aside class="guest-invitation">
  <p class="guest-invitation__message">{message}</p>
  <button
    type="button"
    class="button button--primary"
    onclick={onSignIn}>
    {$t('common.signIn')}
  </button>
</aside>

<style>
  .guest-invitation {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-3);
    margin-top: var(--space-6);
    border: 0.0625rem solid var(--border);
    border-radius: var(--radius-md);
    padding: var(--space-5);
    background: var(--sage);
  }
  .guest-invitation__message {
    margin: 0;
  }
</style>
