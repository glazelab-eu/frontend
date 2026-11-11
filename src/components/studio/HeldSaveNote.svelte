<script lang="ts">
  import { t } from '../../lib/i18n';

  interface Props {
    /** What the writer chose; the text names it. */
    action: 'draft' | 'publish' | 'edit';
    /** The connection is back and the request is on its way. */
    sending: boolean;
    onCancel: () => void;
  }

  let { action, sending, onCancel }: Props = $props();
  const texts = {
    draft: 'studio.held.draft',
    publish: 'studio.held.publish',
    edit: 'studio.held.edit',
  } as const;
  let cancelButton = $state<HTMLButtonElement>();

  /** The save button that held the request is disabled now: focus moves on to the way back. */
  $effect(() => cancelButton?.focus());
</script>

<div
  class="held-save"
  role="status">
  <p class="held-save__text">
    {$t(sending ? 'studio.held.sending' : texts[action])}
  </p>
  {#if !sending}
    <button
      type="button"
      class="held-save__cancel"
      bind:this={cancelButton}
      onclick={onCancel}>
      {$t('studio.held.cancel')}
    </button>
  {/if}
</div>

<style>
  .held-save {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2) var(--space-3);
    margin: 0 0 var(--space-3);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--sage);
    color: var(--ink);
    font-size: var(--font-sm);
    font-weight: 600;
  }
  .held-save__text {
    flex: 1 1 14rem;
    margin: 0;
  }
  .held-save__cancel {
    min-height: var(--touch-target);
    padding: var(--space-1) var(--space-3);
    border: 0.0625rem solid var(--control-border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--ink);
    font-size: var(--font-sm);
    font-weight: 600;
  }
</style>
