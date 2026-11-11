<script lang="ts">
  import { t } from '../../lib/i18n';
  import type { UpdateState } from '../../lib/pwa/update';

  interface Props {
    state: UpdateState;
    onRefresh: () => void;
    onDismiss: () => void;
  }
  let { state, onRefresh, onDismiss }: Props = $props();
</script>

{#if state.available}
  <!-- A toast in App's polite status region (26-7), which announces it: not an error, so no alert, and focus stays where it is. -->
  <div class="update-notice">
    <div class="update-notice__text">
      <p class="update-notice__message">{$t('update.available')}</p>
      {#if state.stale}
        <p class="update-notice__draft">{$t('update.stale')}</p>
      {:else if state.draft}
        <p class="update-notice__draft">{$t('update.draft')}</p>
      {/if}
    </div>
    <div class="update-notice__actions">
      <button
        type="button"
        class="button button--primary"
        onclick={onRefresh}>
        {$t('update.refresh')}
      </button>
      <!-- A stale tab already runs under the new worker: it cannot put the update off, only keep its page until the work is gone. -->
      {#if !state.stale}
        <button
          type="button"
          class="update-notice__later"
          onclick={onDismiss}>
          {$t('update.later')}
        </button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .update-notice {
    pointer-events: auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3) var(--space-4);
    flex-wrap: wrap;
    max-width: 30rem;
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    background: var(--blue);
    color: var(--ink);
    font-size: var(--font-base);
    box-shadow: 0 0.5rem 1.875rem var(--shadow-color);
  }
  @media (prefers-reduced-motion: no-preference) {
    .update-notice {
      animation: update-in 0.15s ease-out;
    }
  }
  @keyframes update-in {
    from {
      opacity: 0;
    }
  }
  .update-notice__message,
  .update-notice__draft {
    margin: 0;
  }
  .update-notice__draft {
    font-size: var(--font-sm);
  }
  .update-notice__actions {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    gap: var(--space-3);
  }
  .update-notice__later {
    background: none;
    border: 0;
    padding: var(--space-2);
    color: var(--accent);
    font-weight: 600;
  }
  @media (width < 45em) {
    .update-notice {
      padding: var(--space-2) var(--space-3);
      gap: var(--space-1) var(--space-3);
    }
    /* The buttons stand beside the message (below it when the language leaves the message too narrow), the unsaved-input line under both. */
    .update-notice__text {
      display: contents;
    }
    .update-notice__message {
      flex: 1 1 8rem;
    }
    .update-notice__actions {
      gap: var(--space-2);
    }
    .update-notice__actions .button {
      padding-inline: var(--space-3);
    }
    .update-notice__draft {
      order: 1;
      flex: 1 0 100%;
    }
  }
  @media (pointer: coarse) {
    .update-notice__later {
      min-width: var(--touch-target);
      min-height: var(--touch-target);
    }
  }
</style>
