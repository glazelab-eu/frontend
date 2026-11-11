<script lang="ts">
  import { t } from '../../lib/i18n';
  import { megabytes } from '../../lib/vision/assets';
  import type { PhotoSuggestionsState } from '../../state/vision/photo-suggestions';

  interface Props {
    state: PhotoSuggestionsState;
    /** Asks to download on a metered connection (`confirm`), and to start again after `offline` or `failed`. */
    onConfirm: () => void;
    onRetry: () => void;
    /** After a slow speed check: keep it on, or turn it off and remove the model. */
    onKeep: () => void;
    onRemove: () => void;
    /** `confirm` also offers "Not now". */
    onLater?: () => void;
  }

  let { state, onConfirm, onRetry, onKeep, onRemove, onLater }: Props = $props();
  const size = $derived(megabytes(state.bytes));
</script>

<!-- What the model is doing on the writer's behalf: the state the feature is in is always said, never silent. -->
{#if state.status === 'confirm'}
  <p class="photo-notice__text">{$t('vision.confirm.body', { values: { size } })}</p>
  <div class="button-row photo-notice__actions">
    <button
      type="button"
      class="button"
      onclick={onConfirm}>
      {$t('vision.confirm.download')}
    </button>
    {#if onLater}
      <button
        type="button"
        class="button"
        onclick={onLater}>
        {$t('vision.consent.later')}
      </button>
    {/if}
  </div>
{:else if state.status === 'loading'}
  <p
    class="photo-notice__text"
    role="status">
    {$t('vision.status.loading', { values: { percent: Math.round(state.progress * 100) } })}
  </p>
{:else if state.status === 'checking'}
  <p
    class="photo-notice__text"
    role="status">
    {$t('vision.status.checking')}
  </p>
{:else if state.status === 'offline' || state.status === 'failed'}
  <p
    class="photo-notice__text"
    role="status">
    {state.status === 'offline' ? $t('vision.status.offline') : $t('vision.status.failed')}
  </p>
  <div class="button-row photo-notice__actions">
    <button
      type="button"
      class="button"
      onclick={onRetry}>
      {$t('common.tryAgain')}
    </button>
  </div>
{:else if state.status === 'slow'}
  <p
    class="photo-notice__text"
    role="status">
    {$t('vision.slow.body', { values: { seconds: ((state.checkMs ?? 0) / 1000).toFixed(1) } })}
  </p>
  <div class="button-row photo-notice__actions">
    <button
      type="button"
      class="button"
      onclick={onKeep}>
      {$t('vision.slow.keep')}
    </button>
    <button
      type="button"
      class="button"
      onclick={onRemove}>
      {$t('vision.remove')}
    </button>
  </div>
{/if}

<style>
  .photo-notice__text {
    margin: 0 0 var(--space-3);
    color: var(--muted);
    font-size: var(--font-sm);
    line-height: 1.5;
  }
  .photo-notice__actions {
    margin-bottom: var(--space-3);
  }
</style>
