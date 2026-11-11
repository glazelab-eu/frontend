<script lang="ts">
  import { t } from '../../lib/i18n';
  import Callout from '../ui/Callout.svelte';
  import Icon from '../ui/Icon.svelte';

  interface Props {
    /** The chosen shelf: "personal" or a club's ID. */
    value: string;
    /** The clubs offered, in order. */
    clubs: readonly { id: string; name: string }[];
    /** Whether the personal shelf is offered (the glaze page's add form leaves out a shelf that already holds the glaze). */
    personal?: boolean;
    disabled?: boolean;
    onChange: (value: string) => void;
  }

  let { value, clubs, personal = true, disabled = false, onChange }: Props = $props();

  let club = $derived(value !== 'personal' ? clubs.find((option) => option.id === value) : undefined);
  const hintId = $props.id();
</script>

<!-- Every form that writes stock: the shelf it writes to and, while a club's is chosen, the club callout under the select
     (outside it, so choosing never remounts the select and its focus stays). -->
<div class={['shelf-select', { 'shelf-select--club': club }]}>
  <label class="form-field shelf-select__field">
    {$t('stock.form.owner')}
    <select
      class="form-field__control"
      {value}
      {disabled}
      aria-describedby={club ? hintId : undefined}
      onchange={(event) => onChange(event.currentTarget.value)}>
      {#if personal}
        <option value="personal">{$t('stock.owner.me')}</option>
      {/if}
      {#each clubs as option (option.id)}
        <option value={option.id}>{option.name}</option>
      {/each}
    </select>
  </label>
  {#if club}
    {#snippet glyph()}<span class="shelf-select__icon"><Icon name="club" /></span>{/snippet}
    <Callout
      tone="warm"
      id={hintId}
      icon={glyph}>
      <p class="shelf-select__words">
        <strong>{$t('stock.scope.club')}</strong>
        <span>{$t('stock.scope.clubHint')}</span>
      </p>
    </Callout>
  {/if}
</div>

<style>
  .shelf-select {
    min-width: 0;
  }
  .shelf-select--club {
    margin-bottom: var(--space-4);
  }
  .shelf-select--club .shelf-select__field {
    margin-bottom: var(--space-2);
  }
  .shelf-select__words {
    display: grid;
    margin: 0;
    font-size: var(--font-sm);
    overflow-wrap: anywhere;
  }
  .shelf-select__icon {
    --icon-size: 1.25rem;
    display: inline-flex;
    color: var(--warm-ink);
  }
  @media (pointer: coarse) {
    .shelf-select__words {
      font-size: var(--font-body);
    }
  }
</style>
