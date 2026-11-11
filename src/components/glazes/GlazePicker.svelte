<script lang="ts">
  import { t } from '../../lib/i18n';
  import type { Glaze } from '../../lib/api/models';
  import { filterGlazes, glazeCode, glazeTitle } from '../../lib/glazes/glazes';
  import Combobox from '../ui/Combobox.svelte';

  interface Props {
    /** The loaded listing (also from the offline snapshot), in the order offered. */
    glazes: Glaze[];
    /** The chosen glaze id, or '' while none is chosen. */
    selectedId: string;
    onSelect: (id: string) => void;
    label: string;
    placeholder: string;
    /** Shown while nothing matches the typed text. */
    noMatchMessage?: string;
    /** The input's text; bind it to clear the input after a choice was used. */
    text?: string;
    required?: boolean;
    disabled?: boolean;
    /** For a filter bar: the label is for screen readers only. */
    compact?: boolean;
    /** Offers "Not in the library? Add it" below the field; the host opens its add-glaze dialog. */
    onAdd?: () => void;
  }

  let {
    glazes,
    selectedId,
    onSelect,
    label,
    placeholder,
    noMatchMessage,
    text = $bindable(''),
    required = true,
    disabled = false,
    compact = false,
    onAdd,
  }: Props = $props();
</script>

<div class="glaze-picker">
  <Combobox
    items={glazes}
    {selectedId}
    {onSelect}
    filter={filterGlazes}
    itemText={glazeTitle}
    optionCode={glazeCode}
    optionText={(glaze) => glaze.name}
    {label}
    {placeholder}
    invalidMessage={$t('stock.form.glazeInvalid')}
    noMatchMessage={noMatchMessage ?? $t('glazePicker.noMatch')}
    noMatchAction={onAdd ? { label: $t('glazePicker.add'), run: onAdd } : undefined}
    matchesMessage={(count) => $t('stock.form.glazeMatches', { values: { count } })}
    {required}
    {disabled}
    {compact}
    bind:text />
  {#if onAdd && !disabled}
    <button
      type="button"
      class="glaze-picker__add"
      onclick={onAdd}>
      {$t('glazePicker.add')}
    </button>
  {/if}
</div>

<style>
  .glaze-picker {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .glaze-picker__add {
    align-self: flex-start;
    margin: calc(-1 * var(--space-2)) 0 var(--space-4);
    padding: var(--space-1) 0;
    border: 0;
    background: none;
    color: var(--accent);
    font-size: var(--font-sm);
    font-weight: 700;
  }
  @media (pointer: coarse) {
    .glaze-picker__add {
      display: inline-flex;
      align-items: center;
      min-height: var(--touch-target);
      margin-top: 0;
      padding-block: 0;
    }
  }
</style>
