<script lang="ts">
  import { t } from '../../lib/i18n';
  import type { SimilarState } from '../../state/vision/similar-looks';

  interface Props {
    state: SimilarState;
    onStop: () => void;
    /** Goes on over a metered connection. */
    onAllowMetered: () => void;
  }

  let { state, onStop, onAllowMetered }: Props = $props();
  const reasons = {
    hidden: 'similar.paused.hidden',
    battery: 'similar.paused.battery',
    offline: 'similar.paused.offline',
    metered: 'similar.paused.metered',
    model: 'similar.paused.model',
    storage: 'similar.paused.storage',
  } as const;
</script>

<!-- What the indexing is doing right now: working (with progress and a stop button) or waiting (and why). Not a live region: the count changes every second. -->
<div class="similar-progress">
  <p class="similar-progress__text">
    {#if state.status === 'paused' && state.paused}
      {$t(reasons[state.paused])}
    {:else}
      {$t('similar.progress', { values: { done: state.done, total: state.total } })}
    {/if}
  </p>
  {#if state.status === 'indexing'}
    <progress
      class="similar-progress__bar"
      value={state.done}
      max={Math.max(1, state.total)}
      aria-label={$t('similar.progress', { values: { done: state.done, total: state.total } })}>
    </progress>
  {/if}
  <div class="button-row">
    {#if state.paused === 'metered'}
      <button
        type="button"
        class="button"
        onclick={onAllowMetered}>
        {$t('similar.allowMetered')}
      </button>
    {/if}
    <button
      type="button"
      class="button"
      onclick={onStop}>
      {$t('similar.stop')}
    </button>
  </div>
</div>

<style>
  .similar-progress__text {
    margin: 0 0 var(--space-2);
    color: var(--muted);
    font-size: var(--font-sm);
    line-height: 1.5;
  }
  .similar-progress__bar {
    display: block;
    width: 100%;
    max-width: 24rem;
    height: 0.5rem;
    margin: 0 0 var(--space-3);
    accent-color: var(--accent);
  }
</style>
