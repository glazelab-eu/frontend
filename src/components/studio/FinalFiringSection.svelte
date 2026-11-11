<script lang="ts">
  import { t } from '../../lib/i18n';
  import {
    atmosphereName,
    atmospheres,
    CLAY_BODY_LENGTH,
    CONE_PATTERN,
    firingInput,
    firingLine,
    firingSectionOpen,
    KILN_LENGTH,
    MAX_TEMPERATURE_C,
    MIN_TEMPERATURE_C,
    type FiringDraft,
  } from '../../lib/firing/firing';
  import { EARLIEST_FIRED_ON, LATEST_FIRED_ON } from '../../lib/images/photo-details';
  import PanelTitle from '../ui/PanelTitle.svelte';

  interface Props {
    firing: FiringDraft;
    /** Clay bodies of the combinations the viewer can see, offered while typing. */
    clayBodies: string[];
    /** Below 720 px the section starts folded behind its heading; wider screens always show it. */
    phone: boolean;
  }

  let { firing = $bindable(), clayBodies, phone }: Props = $props();

  let open = $state(false);
  let expanded = $derived(!phone || open);
  let fields = $state<HTMLElement>();
  /** What is recorded, shown on the folded heading. */
  let summary = $derived(firingLine(firingInput(firing), $t));

  /** Like a step, the section never folds over a field the browser would refuse, however the window changes meanwhile. */
  function toggle() {
    const invalid = fields?.querySelector<HTMLInputElement>(':invalid');
    if (open && invalid) {
      invalid.focus();
      invalid.reportValidity();
      return;
    }
    open = !open;
  }

  /** A field typed invalid on a wide screen keeps the section open if the window later narrows. */
  function checked() {
    open = firingSectionOpen(open, !!fields?.querySelector(':invalid'));
  }
</script>

<section class="panel final-firing">
  {#if phone}
    <button
      type="button"
      class="final-firing__toggle"
      aria-expanded={expanded}
      aria-controls={expanded ? 'final-firing-fields' : undefined}
      onclick={toggle}>
      <span class="final-firing__heading">
        <span class="final-firing__title">{$t('firing.title')}</span>
        <small class="form-field__optional">{$t('common.optional')}</small>
        {#if !expanded && summary}
          <span class="final-firing__summary">{summary}</span>
        {/if}
      </span>
      <span
        class="final-firing__chevron"
        aria-hidden="true">
        {expanded ? '▴' : '▾'}
      </span>
    </button>
  {:else}
    <PanelTitle title={$t('firing.title')} />
  {/if}
  {#if expanded}
    <div
      class="final-firing__fields"
      id="final-firing-fields"
      bind:this={fields}
      oninput={checked}>
      <p class="final-firing__hint">{$t('firing.hint')}</p>
      <div class="final-firing__grid">
        <label class="form-field">
          {$t('firing.cone')}
          <input
            class="form-field__control"
            bind:value={firing.cone}
            placeholder={$t('firing.conePlaceholder')}
            pattern={`\\s*${CONE_PATTERN}\\s*`}
            title={$t('errors.firingCone')}
            maxlength="5"
            inputmode="numeric"
            autocomplete="off" />
        </label>
        <label class="form-field">
          {$t('firing.temperature')}
          <input
            class="form-field__control"
            type="number"
            bind:value={firing.temperatureC}
            min={MIN_TEMPERATURE_C}
            max={MAX_TEMPERATURE_C}
            step="1"
            inputmode="numeric" />
        </label>
        <label class="form-field">
          {$t('firing.atmosphere')}
          <select
            class="form-field__control"
            bind:value={firing.atmosphere}>
            <option value="">{$t('firing.atmosphere.none')}</option>
            {#each atmospheres as atmosphere (atmosphere)}
              <option value={atmosphere}>
                {$t(atmosphereName(atmosphere))}
              </option>
            {/each}
          </select>
        </label>
      </div>
      <div class="final-firing__grid">
        <label class="form-field">
          {$t('firing.clayBody')}
          <input
            class="form-field__control"
            bind:value={firing.clayBody}
            placeholder={$t('firing.clayBodyPlaceholder')}
            maxlength={CLAY_BODY_LENGTH}
            list="final-firing-clay-bodies"
            autocomplete="off" />
        </label>
        <datalist id="final-firing-clay-bodies">
          {#each clayBodies as clayBody (clayBody)}
            <option value={clayBody}></option>
          {/each}
        </datalist>
        <label class="form-field">
          {$t('firing.kiln')}
          <input
            class="form-field__control"
            bind:value={firing.kiln}
            placeholder={$t('firing.kilnPlaceholder')}
            maxlength={KILN_LENGTH} />
        </label>
        <label class="form-field">
          {$t('firing.firedOn')}
          <input
            class="form-field__control"
            type="date"
            min={EARLIEST_FIRED_ON}
            max={LATEST_FIRED_ON}
            bind:value={firing.firedOn} />
        </label>
      </div>
    </div>
  {/if}
</section>

<style>
  .final-firing__toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    width: 100%;
    min-height: var(--touch-target);
    padding: 0;
    border: 0;
    background: none;
    color: var(--ink);
    text-align: left;
  }
  .final-firing__heading {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-1) var(--space-2);
    min-width: 0;
  }
  .final-firing__title {
    font-size: var(--font-lg);
    font-weight: 600;
    letter-spacing: -0.0375rem;
  }
  .final-firing__summary {
    flex: 1 1 100%;
    color: var(--muted);
    font-size: var(--font-sm);
    overflow-wrap: anywhere;
  }
  .final-firing__chevron {
    color: var(--muted);
  }
  .final-firing__hint {
    margin: 0 0 var(--space-4);
    color: var(--muted);
    font-size: var(--font-sm);
  }
  .final-firing__grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
    column-gap: var(--space-4);
  }
  @media (width < 45em) {
    .final-firing__fields {
      margin-top: var(--space-4);
    }
  }
</style>
