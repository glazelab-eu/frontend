<script lang="ts">
  import { t } from '../../lib/i18n';
  import Icon from '../ui/Icon.svelte';
  import { MAX_COATS, MIN_COATS, stepCoats } from '../../lib/studio/step-draft';

  interface Props {
    /** The step's place in the list, from 1. */
    number: number;
    coats: number;
    onChange: (coats: number) => void;
  }

  let { number, coats, onChange }: Props = $props();
</script>

<div class="coats">
  <span
    class="coats__label"
    aria-hidden="true">
    {$t('studio.step.coats')}
  </span>
  <div
    class="coats__stepper"
    role="group"
    aria-label={$t('studio.step.coatsFor', { values: { number } })}>
    <button
      class="icon-button"
      type="button"
      aria-label={$t('studio.step.coatsLess')}
      disabled={coats <= MIN_COATS}
      onclick={() => onChange(stepCoats(coats, -1))}>
      <Icon name="minus" />
    </button>
    <output class="coats__value">{coats}</output>
    <button
      class="icon-button"
      type="button"
      aria-label={$t('studio.step.coatsMore')}
      disabled={coats >= MAX_COATS}
      onclick={() => onChange(stepCoats(coats, 1))}>
      <Icon name="plus" />
    </button>
  </div>
</div>

<style>
  .coats {
    font-size: var(--font-base);
    font-weight: 550;
    margin-bottom: var(--space-4);
  }
  .coats__stepper {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    margin-top: var(--space-1-5);
  }
  .coats__value {
    min-width: 2.25rem;
    text-align: center;
    font-size: var(--font-md);
    font-variant-numeric: tabular-nums;
  }
  @media (pointer: coarse) {
    .coats__stepper {
      gap: var(--space-2);
    }
  }
</style>
