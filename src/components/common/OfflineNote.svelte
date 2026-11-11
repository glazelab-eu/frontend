<script lang="ts">
  import { t } from '../../lib/i18n';

  interface Props {
    online: boolean;
    /** What the note says; by default that saving needs a connection and the input stays. */
    message?: string;
    /** Checks the connection again; the note shows "Try again" for it. */
    onRetry?: () => void;
    /** A check is running, so the button waits. */
    checking?: boolean;
  }

  let { online, message, onRetry, checking = false }: Props = $props();
</script>

{#if !online}
  <div class="offline-note">
    <p class="offline-note__text">{message ?? $t('forms.offline')}</p>
    {#if onRetry}
      <button
        type="button"
        class="offline-note__retry"
        onclick={onRetry}
        disabled={checking}>
        {$t('common.tryAgain')}
      </button>
    {/if}
  </div>
{/if}

<style>
  .offline-note {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2) var(--space-3);
    margin: 0 0 var(--space-3);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--warning-bg);
    color: var(--warning-ink);
    font-size: var(--font-sm);
  }
  .offline-note__text {
    flex: 1 1 14rem;
    margin: 0;
  }
  .offline-note__retry {
    min-height: var(--touch-target);
    padding: var(--space-1) var(--space-3);
    border: 0.0625rem solid currentColor;
    border-radius: var(--radius-sm);
    background: none;
    color: inherit;
    font-size: var(--font-sm);
    font-weight: 600;
  }
</style>
