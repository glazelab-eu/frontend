<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { t, formatNumber, locale } from '../../lib/i18n';
  import type { StockWrite } from '../../lib/api/inputs';
  import type { StockItem } from '../../lib/api/models';
  import type { LeaveGuard } from '../../state/app/app-state';
  import {
    DEFAULT_JAR_G,
    MAX_JAR_G,
    MAX_STOCK_G,
    freeOwners,
    glazeEntries,
    glazeShelfState,
    isUsedUp,
    ownerOf,
    quickAddInput,
    stockFormInput,
    targetClub,
  } from '../../lib/stock/shelf';
  import FormError from '../common/FormError.svelte';
  import OfflineNote from '../common/OfflineNote.svelte';
  import ShelfControls from './ShelfControls.svelte';
  import ShelfSelect from './ShelfSelect.svelte';

  interface Props {
    glazeId: string;
    /** The glaze's display code and name. */
    title: string;
    /** The whole shelf listing: own and club entries of every glaze. */
    stock: StockItem[];
    /** The clubs the account can stock for. */
    clubs: { id: string; name: string }[];
    online: boolean;
    /** Saves an entry from its row (a failure goes to the page's banner). */
    onSave: (input: StockWrite) => Promise<boolean>;
    /** Saves the add form (a failure shows at the form). */
    onAdd: (input: StockWrite, quick?: boolean) => Promise<boolean>;
    onRemove: (id: string) => Promise<boolean>;
    /** The add form's failure message (also the one-click add's). */
    error: string;
    /** Registers the add form's leave guard (`app.registerLeaveGuard`). */
    registerLeaveGuard: (guard: LeaveGuard) => () => void;
  }

  let { glazeId, title, stock, clubs, online, onSave, onAdd, onRemove, error, registerLeaveGuard }: Props = $props();

  let entries = $derived(glazeEntries(stock, glazeId));
  let shelfState = $derived(glazeShelfState(entries));
  let free = $derived(freeOwners(entries, clubs));
  /** The open panel: the entries' controls, or the form that adds the glaze to another shelf. */
  let mode = $state<'update' | 'add' | null>(null);
  let owner = $state('personal');
  let amount = $state<number | null>(DEFAULT_JAR_G);
  let jar = $state<number | null>(null);
  let invalid = $state(false);
  let busy = $state(false);
  /** The last one-click add failed: its error shows beside the button, where no form is open. */
  let quickFailed = $state(false);
  /** No entry on the personal shelf yet (a club's entry does not count): one default jar can be added at once. */
  let quickAdd = $derived(free.includes('personal'));
  let toggle = $state<HTMLButtonElement>();
  let quickButton = $state<HTMLButtonElement>();
  let amountField = $state<HTMLInputElement>();
  /** The add form holds an amount or jar size other than the defaults it opened with: leaving asks first. */
  let addDirty = $derived(mode === 'add' && (amount !== DEFAULT_JAR_G || jar !== null));
  $effect(() => registerLeaveGuard({ dirty: () => addDirty, message: 'drafts.discardShelfScan' }));

  let clubName = $derived(new Map(clubs.map((club) => [club.id, club.name])));
  /** The clubs the add form offers: those without an entry of this glaze. */
  let freeClubs = $derived(free.filter((key) => key !== 'personal').map((id) => ({ id, name: clubName.get(id) ?? '' })));
  /** The club the add form writes to, named on its button; undefined for the personal shelf. */
  let addClub = $derived(targetClub(owner, clubs));
  const entryLabel = (item: StockItem) => (item.clubId ? (item.clubName ?? clubName.get(item.clubId) ?? '') : $t('stock.group.personal'));

  /** "450 g", or "Sunday Clay Studio: 1,500 g" for a club's entry; "used up" instead of 0 g. */
  function part(item: StockItem) {
    const quantity = isUsedUp(item) ? $t('glaze.shelf.partUsedUp') : `${$formatNumber(item.quantityG)} g`;
    return item.clubId ? $t('glaze.shelf.clubPart', { values: { club: entryLabel(item), quantity } }) : quantity;
  }

  /**
   * "On your shelf: …" only with a personal entry; a glaze only club shelves hold says where it is available instead
   * ("Available in Sunday Clay Studio: 1,500 g"), or, with every club entry used up, where it was used up.
   */
  let summary = $derived.by(() => {
    if (shelfState === 'none') return $t('glaze.shelf.none');
    if (entries.some((item) => !item.clubId)) return $t('glaze.shelf.on', { values: { parts: entries.map(part).join(' · ') } });
    const stocked = entries.filter((item) => !isUsedUp(item));
    if (stocked.length) return $t('glaze.shelf.inClubs', { values: { parts: stocked.map(part).join(' · '), count: stocked.length } });
    const clubs = new Intl.ListFormat($locale ?? 'en', { type: 'conjunction' }).format(entries.map(entryLabel));
    return $t('glaze.shelf.usedUpInClubs', { values: { clubs, count: entries.length } });
  });

  // Offline the shelf line is read-only; a half-typed form is dropped with the connection.
  $effect(() => {
    if (!online) mode = null;
  });
  // The last entry went (removed): nothing is left to update.
  $effect(() => {
    if (mode === 'update' && !entries.length) mode = null;
  });
  // The shelf of an add form that no longer exists (a saved or removed club) is replaced by the personal shelf; never by
  // another club, which nobody chose (SHELF-3): without a free personal shelf the form closes.
  $effect(() => {
    if (free.includes(owner)) return;
    if (free.includes('personal')) owner = 'personal';
    else if (untrack(() => mode) === 'add') mode = entries.length ? 'update' : null;
  });

  async function focusToggle() {
    await tick();
    toggle?.focus();
  }

  async function startAdd() {
    amount = DEFAULT_JAR_G;
    jar = null;
    invalid = false;
    quickFailed = false;
    owner = free[0] ?? 'personal';
    mode = 'add';
    await tick();
    amountField?.focus();
  }

  function cancelAdd() {
    mode = entries.length ? 'update' : null;
    void focusToggle();
  }

  function toggleMode() {
    if (mode) mode = null;
    else if (entries.length) mode = 'update';
    else void startAdd();
  }

  async function submitAdd(event: SubmitEvent) {
    event.preventDefault();
    if (busy || !online) return;
    const input = stockFormInput(glazeId, owner, undefined, { mode: 'set', amount, jar });
    if (!input) {
      invalid = true;
      amountField?.focus();
      return;
    }
    busy = true;
    try {
      if (await onAdd(input)) {
        mode = null;
        void focusToggle();
      }
    } finally {
      busy = false;
    }
  }

  async function addQuick() {
    const input = quickAddInput(glazeId);
    if (busy || !online || !input) return;
    busy = true;
    quickFailed = false;
    try {
      if (await onAdd(input, true)) {
        mode = null;
        void focusToggle();
      } else quickFailed = true;
    } finally {
      busy = false;
      // A disabled button drops focus: after a failure the person retries from the same button.
      if (quickFailed) {
        await tick();
        quickButton?.focus();
      }
    }
  }

  async function remove(id: string) {
    const removed = await onRemove(id);
    if (removed) void focusToggle();
    return removed;
  }
</script>

<section
  class="glaze-shelf"
  aria-label={$t('glaze.shelf.label')}>
  <div class="glaze-shelf__line">
    <p class="glaze-shelf__summary">
      {summary}
    </p>
    {#if online}
      {#if quickAdd}
        <button
          bind:this={quickButton}
          type="button"
          class="button button--primary glaze-shelf__quick"
          disabled={busy}
          aria-label={$t('glaze.shelf.quickAddFor', { values: { size: DEFAULT_JAR_G, glaze: title } })}
          onclick={addQuick}>
          {$t('glaze.shelf.quickAdd')}
        </button>
      {/if}
      <button
        bind:this={toggle}
        type="button"
        class="button glaze-shelf__toggle"
        aria-expanded={mode !== null}
        aria-controls="glaze-shelf-panel"
        aria-label={shelfState === 'none' ? $t('glaze.shelf.addFor', { values: { glaze: title } }) : $t('glaze.shelf.updateFor', { values: { glaze: title } })}
        onclick={toggleMode}>
        {shelfState === 'none' ? $t('glaze.shelf.add') : $t('glaze.shelf.update')}
      </button>
    {/if}
  </div>
  {#if quickFailed && mode !== 'add'}
    <div class="glaze-shelf__error"><FormError message={error} /></div>
  {/if}
  <OfflineNote
    {online}
    message={$t('glaze.shelf.offline')} />
  <div id="glaze-shelf-panel">
    {#if mode === 'update'}
      <ul class="glaze-shelf__entries">
        {#each entries as item (item.id)}
          <li
            class="glaze-shelf__entry"
            data-stock-id={item.id}>
            <span class="glaze-shelf__owner">{entryLabel(item)}</span>
            <ShelfControls
              {item}
              {title}
              {online}
              {onSave}
              onRemove={remove} />
          </li>
        {/each}
      </ul>
      {#if free.length}
        <button
          type="button"
          class="button glaze-shelf__another"
          onclick={startAdd}>
          {$t('glaze.shelf.addAnother')}
        </button>
      {/if}
    {:else if mode === 'add'}
      <form
        class="glaze-shelf__form"
        onsubmit={submitAdd}
        aria-busy={busy}>
        {#if clubs.length}
          <div class="glaze-shelf__owner-field">
            <ShelfSelect
              value={owner}
              clubs={freeClubs}
              personal={free.includes('personal')}
              onChange={(key) => (owner = key)} />
          </div>
        {/if}
        <label class="form-field glaze-shelf__field">
          {$t('stock.form.quantity')}
          <input
            bind:this={amountField}
            bind:value={amount}
            oninput={() => (invalid = false)}
            class="form-field__control"
            type="number"
            inputmode="numeric"
            min="0"
            max={MAX_STOCK_G}
            step="1"
            aria-invalid={invalid}
            aria-describedby={invalid ? 'glaze-shelf-invalid' : undefined}
            required />
        </label>
        <label class="form-field glaze-shelf__field">
          <span>
            {$t('stock.form.jarSize')}
            <small class="form-field__optional">{$t('common.optional')}</small>
          </span>
          <input
            bind:value={jar}
            oninput={() => (invalid = false)}
            class="form-field__control"
            type="number"
            inputmode="numeric"
            min="1"
            max={MAX_JAR_G}
            step="1" />
        </label>
        {#if invalid}
          <p
            class="glaze-shelf__invalid"
            id="glaze-shelf-invalid"
            role="alert">
            {$t('glaze.shelf.invalid')}
          </p>
        {/if}
        <div class="glaze-shelf__error"><FormError message={error} /></div>
        <div class="button-row glaze-shelf__actions">
          <button
            class="button button--primary"
            disabled={busy || !online}>
            {addClub ? $t('stock.target.addClub', { values: { club: addClub.name } }) : $t('stock.target.add')}
          </button>
          <button
            type="button"
            class="button"
            onclick={cancelAdd}>
            {$t('common.cancel')}
          </button>
        </div>
      </form>
    {/if}
  </div>
</section>

<style>
  .glaze-shelf {
    margin: var(--space-3) 0 var(--space-2);
  }
  .glaze-shelf__line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
  }
  .glaze-shelf__summary {
    margin: 0;
    flex: 1 1 12rem;
    min-width: 0;
    color: var(--accent);
    font-size: var(--font-sm);
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .glaze-shelf__quick,
  .glaze-shelf__toggle,
  .glaze-shelf__another,
  .glaze-shelf__actions .button {
    min-height: var(--touch-target);
    font-size: var(--font-sm);
  }
  .glaze-shelf__quick,
  .glaze-shelf__actions .button--primary {
    border-color: var(--accent);
  }
  .glaze-shelf__entries {
    margin: var(--space-2) 0 0;
    padding: 0;
    list-style: none;
  }
  .glaze-shelf__entry {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    border-top: 0.0625rem solid var(--border);
    padding: var(--space-2) 0;
  }
  .glaze-shelf__owner {
    flex: 1 1 8rem;
    min-width: 0;
    font-size: var(--font-sm);
    font-weight: 700;
    overflow-wrap: anywhere;
  }
  .glaze-shelf__another {
    margin-top: var(--space-2);
  }
  .glaze-shelf__form {
    margin-top: var(--space-3);
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
    /* Inputs share the row's bottom however many lines their labels take. */
    align-items: end;
    gap: 0 var(--space-4);
  }
  .glaze-shelf__owner-field,
  .glaze-shelf__invalid,
  .glaze-shelf__error,
  .glaze-shelf__actions {
    grid-column: 1 / -1;
  }
  .glaze-shelf__invalid {
    margin: 0 0 var(--space-3);
    color: var(--danger-ink);
    font-size: var(--font-xs);
  }
</style>
