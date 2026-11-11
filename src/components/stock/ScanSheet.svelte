<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Icon from '../ui/Icon.svelte';
  import { t, formatNumber } from '../../lib/i18n';
  import type { Club } from '../../lib/api/models';
  import FormError from '../common/FormError.svelte';
  import OfflineNote from '../common/OfflineNote.svelte';
  import ShelfSelect from './ShelfSelect.svelte';
  import { MAX_JAR_G, MAX_STOCK_G, targetClub } from '../../lib/stock/shelf';
  import { sheetInput, sheetJar, sheetQuickInput, sheetUsedUpInput, steppedAmount, stepSheet, type ScanSheet } from '../../lib/stock/scan-sheet';

  interface Props {
    /** The glaze's display code and name. */
    title: string;
    /** The sheet's fields; the large buttons and inputs change them. */
    sheet: ScanSheet;
    /** The account's clubs: with any, the sheet offers a choice of shelf. */
    clubs: Club[];
    online: boolean;
    busy: boolean;
    /** Why the last save failed. */
    error: string;
    onOwner: (owner: string) => void;
    /** Saves the sheet's amount; the page scans the next jar when it worked. */
    onSave: () => void;
    /** Saves the default jar at once (a glaze the shelf does not hold). */
    onQuick: () => Promise<void>;
    /** Saves 0 g at once. */
    onUsedUp: () => void;
    /** Scans the next jar without saving. */
    onSkip: () => void;
  }

  let { title, sheet = $bindable(), clubs, online, busy, error, onOwner, onSave, onQuick, onUsedUp, onSkip }: Props = $props();

  let heading: HTMLHeadingElement;
  let quickButton = $state<HTMLButtonElement>();
  /** A disabled button drops focus: when the save failed the sheet is still here, and the person retries from the same button. */
  async function quick() {
    await onQuick();
    await tick();
    quickButton?.focus();
  }
  onMount(() => heading.focus());

  let jar = $derived(sheetJar(sheet));
  /** The club the sheet saves to, named on its save buttons; undefined for the personal shelf. */
  let club = $derived(targetClub(sheet.owner, clubs));
  let canSave = $derived(online && !busy && sheetInput(sheet) !== null);
  let canQuick = $derived(online && !busy && sheetQuickInput(sheet) !== null);
  let canUsedUp = $derived(online && !busy && sheetUsedUpInput(sheet) !== null);
</script>

<form
  class="scan-sheet"
  aria-busy={busy}
  onsubmit={(event) => {
    event.preventDefault();
    if (canSave) onSave();
  }}>
  <h3
    bind:this={heading}
    class="scan-sheet__glaze"
    tabindex="-1">
    {title}
  </h3>
  {#if clubs.length}
    <ShelfSelect
      value={sheet.owner}
      {clubs}
      disabled={busy}
      onChange={onOwner} />
  {/if}
  <p
    class="scan-sheet__current"
    role="status">
    {sheet.entry ? $t('stock.form.current', { values: { quantity: $formatNumber(sheet.entry.quantityG) } }) : $t('stock.scan.notOnShelf')}
  </p>
  <div
    class="scan-sheet__amount"
    role="group"
    aria-label={$t('stock.scan.amountLabel', { values: { glaze: title } })}>
    <button
      type="button"
      class="icon-button scan-sheet__step"
      disabled={busy || !online || steppedAmount(sheet, -1) === null}
      aria-label={$t('stock.scan.lessJar')}
      onclick={() => (sheet = stepSheet(sheet, -1))}>
      <Icon name="minus" />
    </button>
    <label class="scan-sheet__grams">
      <span class="scan-sheet__grams-label">{$t('stock.scan.grams')}</span>
      <input
        class="form-field__control scan-sheet__input"
        type="number"
        inputmode="numeric"
        min="0"
        max={MAX_STOCK_G}
        step="1"
        disabled={busy || !online}
        bind:value={sheet.amount}
        oninput={() => (sheet.typed = true)}
        required />
    </label>
    <button
      type="button"
      class="icon-button scan-sheet__step"
      disabled={busy || !online || steppedAmount(sheet, 1) === null}
      aria-label={$t('stock.scan.moreJar')}
      onclick={() => (sheet = stepSheet(sheet, 1))}>
      <Icon name="plus" />
    </button>
  </div>
  <label class="scan-sheet__jar">
    {$t('stock.form.jarSize')}
    <input
      class="form-field__control"
      type="number"
      inputmode="numeric"
      min="1"
      max={MAX_JAR_G}
      step="1"
      disabled={busy || !online}
      bind:value={sheet.jar}
      aria-describedby="scan-sheet-jar-hint" />
  </label>
  <small
    class="scan-sheet__hint"
    id="scan-sheet-jar-hint">
    {jar === null ? $t('stock.scan.jarHint') : $t('stock.scan.stepHint', { values: { quantity: $formatNumber(jar) } })}
  </small>
  <OfflineNote {online} />
  <FormError message={error} />
  <div class="scan-sheet__actions">
    {#if sheetQuickInput(sheet)}
      <button
        bind:this={quickButton}
        type="button"
        class="button button--primary scan-sheet__save scan-sheet__quick"
        disabled={!canQuick}
        onclick={quick}>
        {club ? $t('stock.scan.quickAddClub', { values: { club: club.name } }) : $t('glaze.shelf.quickAdd')}
      </button>
    {/if}
    <button
      class={['button scan-sheet__save', { 'button--primary': !sheetQuickInput(sheet) }]}
      disabled={!canSave}>
      {club ? $t('stock.scan.saveNextClub', { values: { club: club.name } }) : $t('stock.scan.saveNext')}
    </button>
    <button
      type="button"
      class="button scan-sheet__other"
      disabled={!canUsedUp}
      onclick={onUsedUp}>
      {$t('stock.row.usedUp')}
    </button>
    <button
      type="button"
      class="button scan-sheet__other"
      disabled={busy}
      onclick={onSkip}>
      {$t('stock.scan.skip')}
    </button>
  </div>
</form>

<style>
  .scan-sheet {
    display: grid;
    gap: var(--space-3);
    margin-top: var(--space-3);
  }
  .scan-sheet__glaze {
    margin: 0;
    font-size: var(--font-md);
    overflow-wrap: anywhere;
  }
  .scan-sheet__jar {
    font-size: var(--font-sm);
    font-weight: 550;
  }
  .scan-sheet__current,
  .scan-sheet__hint {
    margin: 0;
    color: var(--muted);
    font-size: var(--font-sm);
  }
  .scan-sheet__hint {
    margin-top: calc(-1 * var(--space-2));
    font-size: var(--font-xs);
  }
  .scan-sheet__amount {
    display: grid;
    grid-template-columns: 4rem minmax(0, 1fr) 4rem;
    align-items: end;
    gap: var(--space-3);
  }
  .scan-sheet__step {
    width: 100%;
    height: 3.5rem;
  }
  .scan-sheet__grams {
    display: block;
    min-width: 0;
    font-size: var(--font-xs);
    font-weight: 550;
    text-align: center;
  }
  .scan-sheet__grams-label {
    display: block;
    margin-bottom: var(--space-1);
  }
  .scan-sheet__input {
    min-height: 3.5rem;
    margin: 0;
    font-size: var(--font-xl);
    font-weight: 600;
    text-align: center;
  }
  .scan-sheet__actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-3);
  }
  .scan-sheet__save {
    grid-column: 1 / -1;
  }
  .scan-sheet__save,
  .scan-sheet__other {
    min-height: 3rem;
    white-space: normal;
  }
  @media (pointer: coarse) {
    .scan-sheet__hint,
    .scan-sheet__grams {
      font-size: var(--font-body);
    }
  }
</style>
