<script lang="ts">
  import { t, translate } from '../../lib/i18n';
  import type { Glaze } from '../../lib/api/models';
  import type { StepDraft } from '../../lib/studio/step-draft';
  import { isFinished, stepName, stepSummary } from '../../lib/studio/step-summary';
  import GlazePicker from '../glazes/GlazePicker.svelte';
  import StepControls from './StepControls.svelte';
  import CoatsStepper from './CoatsStepper.svelte';
  import MethodField from './MethodField.svelte';

  interface Props {
    step: StepDraft;
    /** The step's place in the list, from 1. */
    number: number;
    first: boolean;
    last: boolean;
    locked?: boolean;
    /** Glazes in the order the picker offers them. */
    glazes: Glaze[];
    glazesById: ReadonlyMap<string, Glaze>;
    /** Below 720 px: a finished step's header can fold the step into its summary line. */
    phone: boolean;
    /** Show only the summary line (phone only; the page decides with `isCollapsed`). */
    collapsed: boolean;
    onToggle: () => void;
    onMove: (delta: -1 | 1) => void;
    onRemove: () => void;
    onAddGlaze: () => void;
  }

  let {
    step = $bindable(),
    number,
    first,
    last,
    locked = false,
    glazes,
    glazesById,
    phone,
    collapsed,
    onToggle,
    onMove,
    onRemove,
    onAddGlaze,
  }: Props = $props();

  const quickLabels = ['studio.step.chip.bisque', 'studio.step.chip.glaze', 'studio.step.chip.refire'] as const;

  let labels = $derived({
    coats: (count: number) => $t('combination.coatCount', { values: { count } }),
    noGlaze: $t('studio.step.summary.noGlaze'),
    noLabel: $t('studio.step.summary.noLabel'),
  });
  let summary = $derived(stepSummary(step, number, glazesById, labels));
  /** The name only once there is one, so a new step reads "Step 2". */
  let named = $derived(stepName(step, glazesById));
  let foldable = $derived(phone && isFinished(step));
</script>

{#snippet heading(withName: boolean)}
  <span class="step-number">{number}</span>
  <strong class="step-editor__title">
    {$t('studio.step.title')}
    {number}
    {#if withName && named}
      <span class="step-editor__glaze">· {named}</span>
    {/if}
  </strong>
{/snippet}

<div
  class={['step-editor', { 'step-editor--collapsed': collapsed }]}
  id="step-{step.key}">
  <div class={['step-editor__header', { 'step-editor__header--collapsed': collapsed }]}>
    {#if foldable}
      <button
        id="step-{step.key}-toggle"
        class="step-editor__toggle"
        type="button"
        aria-expanded={!collapsed}
        aria-controls={collapsed ? undefined : `step-${step.key}-body`}
        onclick={onToggle}>
        {#if collapsed}
          <span class="step-editor__summary">{summary}</span>
        {:else}
          {@render heading(false)}
        {/if}
        <span
          class="step-editor__chevron"
          aria-hidden="true">
          {collapsed ? '▾' : '▴'}
        </span>
      </button>
    {:else}
      {@render heading(true)}
    {/if}
    {#if !collapsed}
      <div class="step-editor__controls">
        <StepControls
          {number}
          idBase="step-{step.key}"
          {first}
          {last}
          {locked}
          {onMove}
          {onRemove} />
      </div>
    {/if}
  </div>
  {#if !collapsed}
    <fieldset
      class="step-editor__fields"
      id="step-{step.key}-body"
      disabled={locked}>
      {#if step.type === 'CUSTOM'}
        <label class="form-field">
          {$t('studio.step.label')}
          <input
            class="form-field__control"
            bind:value={step.label}
            placeholder={$t('studio.step.labelPlaceholder')}
            required
            maxlength="80" />
        </label>
        <div
          class="step-editor__chips"
          role="group"
          aria-label={$t('studio.step.chips')}>
          {#each quickLabels as key (key)}
            <button
              class="step-editor__chip"
              type="button"
              onclick={() => (step.label = translate(key))}>
              {$t(key)}
            </button>
          {/each}
        </div>
        <label class="form-field">
          {$t('studio.step.details')}
          <input
            class="form-field__control"
            bind:value={step.notes}
            placeholder={$t('studio.step.detailsPlaceholder')}
            maxlength="500" />
        </label>
      {:else}
        <div class="step-editor__glaze-row">
          <GlazePicker
            {glazes}
            selectedId={step.glazeId}
            onSelect={(id) => {
              if (!locked) step.glazeId = id;
            }}
            label={$t('common.glaze')}
            placeholder={$t('studio.step.glazePlaceholder')}
            onAdd={onAddGlaze} />
          <CoatsStepper
            {number}
            coats={step.coats}
            onChange={(coats) => (step.coats = coats)} />
        </div>
        <MethodField bind:value={step.method} />
        <label class="form-field">
          {$t('studio.step.notes')}
          <input
            class="form-field__control"
            bind:value={step.notes}
            placeholder={$t('studio.step.notesPlaceholder')} />
        </label>
      {/if}
    </fieldset>
  {/if}
</div>

<style>
  .step-editor__fields {
    border: 0;
    padding: 0;
    margin: 0;
    min-width: 0;
  }
  .step-editor {
    border: 0.0625rem solid var(--border);
    border-radius: var(--radius-md);
    padding: var(--space-4);
    margin-bottom: var(--space-3);
    background: var(--canvas);
  }
  .step-editor--collapsed {
    padding: 0;
  }
  /* The controls wrap below the title only when the title's longest word would not fit beside them. */
  .step-editor__header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-4);
  }
  .step-editor__header--collapsed {
    margin-bottom: 0;
  }
  /* Its narrowest width is its longest word ("Passaggio"): never `overflow-wrap: anywhere` or `min-width: 0` here, which let the
     flex row squeeze the label letter by letter (LANG-4). Only the glaze name, user text, may break anywhere. */
  .step-editor__title {
    flex: 1 1 0;
    font-size: var(--font-xs);
  }
  .step-editor__glaze {
    font-weight: 400;
    overflow-wrap: anywhere;
  }
  .step-editor__controls {
    margin-left: auto;
  }
  .step-editor__toggle {
    display: flex;
    flex: 1 1 0;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--touch-target);
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    padding: 0;
    color: var(--ink);
    text-align: left;
  }
  .step-editor__header--collapsed .step-editor__toggle {
    padding: var(--space-2) var(--space-4);
  }
  /* One logical line: it wraps (two lines at most) rather than cut off the method on a narrow phone. */
  .step-editor__summary {
    flex: 1 1 0;
    min-width: 0;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    overflow-wrap: anywhere;
    font-size: var(--font-base);
    font-weight: 600;
  }
  .step-editor__chevron {
    margin-left: auto;
    color: var(--accent);
    font-size: var(--font-md);
  }
  .step-editor__glaze-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    column-gap: var(--space-4);
    align-items: start;
  }
  .step-editor__chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
  }
  .step-editor__chip {
    border: 0;
    border-radius: var(--radius-pill);
    background: var(--sage);
    padding: var(--space-1-5) var(--space-3);
    color: var(--accent);
    font-size: var(--font-xs);
    font-weight: 700;
  }
  @media (width < 45em) {
    .step-editor__glaze-row {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  @media (pointer: coarse) {
    .step-editor__chip {
      min-height: var(--touch-target);
      font-size: var(--font-body);
    }
  }
</style>
