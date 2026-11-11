<script lang="ts">
  import { t } from '../../lib/i18n';
  import type { Glaze } from '../../lib/api/models';
  import { suggestTags, type TagCount } from '../../lib/tags/tags';
  import { atmosphereName, atmospheres, type Atmosphere } from '../../lib/firing/firing';
  import Combobox from '../ui/Combobox.svelte';
  import GlazePicker from '../glazes/GlazePicker.svelte';

  interface Props {
    glazes: Glaze[];
    tagCounts: TagCount[];
    tags: string[];
    onTag: (tag: string) => void;
    onGlaze: (id: string) => void;
    /**
     * The final-firing filters, shown while they apply (not for Glazes): the cones of the listed
     * combinations in firing order, and the chosen cone and atmosphere.
     */
    firing?: {
      cones: string[];
      cone?: string;
      atmosphere?: Atmosphere;
      onCone: (cone: string | undefined) => void;
      onAtmosphere: (atmosphere: Atmosphere | undefined) => void;
    };
    tagText?: string;
    glazeText?: string;
    compact?: boolean;
  }
  let { glazes, tagCounts, tags, onTag, onGlaze, firing, tagText = $bindable(''), glazeText = $bindable(''), compact = false }: Props = $props();
  let tagOptions = $derived(tagCounts.map(({ tag, count }) => ({ id: tag, count })));
  /** A cone from the link stays choosable even when no listed combination has it. */
  let coneOptions = $derived(firing?.cone && !firing.cones.includes(firing.cone) ? [firing.cone, ...firing.cones] : (firing?.cones ?? []));
</script>

<div class={['explore-filters', { 'explore-filters--compact': compact }]}>
  <div class="explore-filters__picker">
    <Combobox
      items={tagOptions}
      selectedId=""
      onSelect={onTag}
      filter={(_, text) => suggestTags(tagCounts, text, tags, 12).map(({ tag, count }) => ({ id: tag, count }))}
      itemText={(option) => option.id}
      optionCode={(option) => $t('discover.filter.tagCount', { values: { count: option.count } })}
      optionText={(option) => option.id}
      label={$t('discover.filter.tags')}
      placeholder={$t('discover.filter.tagsPlaceholder')}
      invalidMessage={$t('discover.filter.tagInvalid')}
      noMatchMessage={$t('discover.filter.tagNoMatch')}
      matchesMessage={(count) => $t('tags.matches', { values: { count } })}
      required={false}
      {compact}
      bind:text={tagText} />
  </div>
  <div class="explore-filters__picker">
    <GlazePicker
      {glazes}
      selectedId=""
      onSelect={onGlaze}
      label={$t('discover.filter.glaze')}
      placeholder={$t('discover.filter.glazePlaceholder')}
      noMatchMessage={$t('glazePicker.noMatch')}
      required={false}
      {compact}
      bind:text={glazeText} />
  </div>
  {#if firing}
    {@const { cone, atmosphere, onCone, onAtmosphere } = firing}
    <label class={['form-field', 'explore-filters__select', { 'explore-filters__select--compact': compact }]}>
      <span class={{ 'visually-hidden': compact }}>{$t('discover.filter.cone')}</span>
      <select
        class={['form-field__control', { 'explore-filters__control--compact': compact }]}
        value={cone ?? ''}
        onchange={(event) => onCone(event.currentTarget.value || undefined)}>
        <option value="">{$t('discover.filter.anyCone')}</option>
        {#each coneOptions as option (option)}
          <option value={option}>
            {$t('firing.line.cone', { values: { cone: option } })}
          </option>
        {/each}
      </select>
    </label>
    <label class={['form-field', 'explore-filters__select', { 'explore-filters__select--compact': compact }]}>
      <span class={{ 'visually-hidden': compact }}>{$t('discover.filter.atmosphere')}</span>
      <select
        class={['form-field__control', { 'explore-filters__control--compact': compact }]}
        value={atmosphere ?? ''}
        onchange={(event) => onAtmosphere((event.currentTarget.value || undefined) as Atmosphere | undefined)}>
        <option value="">{$t('discover.filter.anyAtmosphere')}</option>
        {#each atmospheres as option (option)}
          <option value={option}>
            {$t(atmosphereName(option))}
          </option>
        {/each}
      </select>
    </label>
  {/if}
</div>

<style>
  .explore-filters {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .explore-filters--compact {
    flex: 1 1 40rem;
    min-width: 0;
    flex-direction: row;
  }
  .explore-filters__picker {
    flex: 1 1 15rem;
    min-width: 0;
  }
  /* The firing selects keep their natural width; the pickers give way. */
  .explore-filters__select--compact {
    flex: 0 0 auto;
    margin-bottom: 0;
  }
  /* Matches the other filter bar controls. */
  .explore-filters__control--compact {
    margin-top: 0;
    min-height: var(--control-height);
    padding-block: var(--space-2);
    background: var(--surface);
    font-size: var(--font-base);
  }
  .explore-filters:not(.explore-filters--compact) .explore-filters__picker {
    flex-basis: auto;
    margin-bottom: var(--space-3);
  }
</style>
