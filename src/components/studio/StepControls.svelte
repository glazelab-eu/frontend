<script lang="ts">
  import { t } from '../../lib/i18n';
  import Icon from '../ui/Icon.svelte';

  interface Props {
    /** The step's place in the list, from 1. */
    number: number;
    /** Prefix of the button ids, so the page can return focus to a step after a move. */
    idBase: string;
    first: boolean;
    last: boolean;
    locked?: boolean;
    onMove: (delta: -1 | 1) => void;
    onRemove: () => void;
  }

  let { number, idBase, first, last, locked = false, onMove, onRemove }: Props = $props();
</script>

<div class="step-controls">
  <button
    id="{idBase}-up"
    class="icon-button"
    type="button"
    title={$t('studio.step.moveUp', { values: { number } })}
    aria-label={$t('studio.step.moveUp', { values: { number } })}
    disabled={locked || first}
    onclick={() => onMove(-1)}>
    <Icon name="up" />
  </button>
  <button
    id="{idBase}-down"
    class="icon-button"
    type="button"
    title={$t('studio.step.moveDown', { values: { number } })}
    aria-label={$t('studio.step.moveDown', { values: { number } })}
    disabled={locked || last}
    onclick={() => onMove(1)}>
    <Icon name="down" />
  </button>
  <button
    id="{idBase}-remove"
    class="icon-button step-controls__remove"
    type="button"
    title={$t('studio.step.remove', { values: { number } })}
    aria-label={$t('studio.step.remove', { values: { number } })}
    disabled={locked}
    onclick={onRemove}>
    <Icon name="close" />
  </button>
</div>

<style>
  .step-controls {
    display: flex;
    gap: var(--space-1);
  }
  @media (pointer: coarse) {
    .step-controls {
      gap: var(--space-2);
    }
    /* The destructive button keeps a full touch gap from the move buttons. */
    .step-controls__remove {
      margin-inline-start: calc(var(--touch-gap) - var(--space-2));
    }
  }
</style>
