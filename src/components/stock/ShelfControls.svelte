<script lang="ts">
  import { tick } from 'svelte';
  import { lifetime } from '../../state/shared/lifetime';
  import { t, formatNumber } from '../../lib/i18n';
  import type { StockWrite } from '../../lib/api/inputs';
  import type { StockItem } from '../../lib/api/models';
  import { MAX_JAR_G, MAX_STOCK_G, isUsedUp, oneJarInput, parseGrams, stockInputFor, usedUpInput } from '../../lib/stock/shelf';

  interface Props {
    item: StockItem;
    /** The glaze's display code and name (the buttons' accessible names). */
    title: string;
    /** Offline the entry is read-only: the amount is text and there are no buttons. */
    online: boolean;
    onSave: (input: StockWrite) => Promise<boolean>;
    onRemove: (id: string) => Promise<boolean>;
  }

  let { item, title, online, onSave, onRemove }: Props = $props();

  let usedUp = $derived(isUsedUp(item));
  /** The open inline field: the amount, or the jar size "+1 jar" still has to ask for. */
  let editing = $state<'amount' | 'jar' | null>(null);
  let draft = $state<number | null>(null);
  let invalid = $state(false);
  let busy = $state(false);
  let field = $state<HTMLInputElement>();
  let amountButton = $state<HTMLButtonElement>();
  let jarButton = $state<HTMLButtonElement>();
  const life = lifetime();

  // A connection loss closes a half-typed field.
  $effect(() => {
    if (!online) editing = null;
  });

  async function open(kind: 'amount' | 'jar') {
    editing = kind;
    draft = kind === 'amount' ? item.quantityG : null;
    invalid = false;
    await tick();
    field?.focus();
    field?.select();
  }

  async function close() {
    const jar = editing === 'jar';
    editing = null;
    await tick();
    if (life.mounted()) (jar ? jarButton : amountButton)?.focus();
  }

  /** Runs one write; the entry stays as it is on failure (the page shows the error). */
  async function run(input: StockWrite | null) {
    if (busy || !online) return;
    if (!input) {
      invalid = true;
      field?.focus();
      return;
    }
    busy = true;
    let saved = false;
    try {
      saved = await onSave(input);
    } finally {
      busy = false;
    }
    if (saved && life.mounted() && editing) await close();
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (editing === 'amount') {
      const grams = parseGrams(draft);
      void run(grams === null ? null : stockInputFor(item, grams));
    } else {
      void run(oneJarInput(item, parseGrams(draft, { min: 1, max: MAX_JAR_G })));
    }
  }

  function oneJar() {
    if (busy) return;
    const input = oneJarInput(item);
    if (input) void run(input);
    else void open('jar');
  }

  async function remove() {
    if (busy || !online) return;
    busy = true;
    try {
      await onRemove(item.id);
    } finally {
      busy = false;
    }
  }
</script>

{#if editing}
  <form
    class="shelf-controls shelf-controls--edit"
    onsubmit={submit}
    aria-busy={busy}>
    <label class="shelf-controls__field">
      <span class="shelf-controls__field-label">
        {editing === 'jar'
          ? $t('stock.row.jarLabel', { values: { glaze: title } })
          : item.clubId && item.clubName
            ? $t('stock.row.amountLabelClub', { values: { glaze: title, club: item.clubName } })
            : $t('stock.row.amountLabel', { values: { glaze: title } })}
      </span>
      <input
        bind:this={field}
        bind:value={draft}
        oninput={() => (invalid = false)}
        onkeydown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          event.stopPropagation();
          void close();
        }}
        class="form-field__control shelf-controls__input"
        type="number"
        inputmode="numeric"
        min={editing === 'amount' ? 0 : 1}
        max={editing === 'amount' ? MAX_STOCK_G : MAX_JAR_G}
        step="1"
        aria-invalid={invalid}
        aria-describedby={invalid ? `${item.id}-invalid` : undefined}
        required />
    </label>
    <button
      class="button button--primary shelf-controls__button"
      aria-disabled={busy || undefined}>
      {editing === 'amount' ? $t('stock.row.save') : $t('stock.row.addJar')}
    </button>
    <button
      type="button"
      class="button shelf-controls__button"
      onclick={close}>
      {$t('common.cancel')}
    </button>
    {#if editing === 'jar'}
      <p class="shelf-controls__hint">{$t('stock.row.jarHint')}</p>
    {/if}
    {#if invalid}
      <p
        class="shelf-controls__invalid"
        id={`${item.id}-invalid`}
        role="alert">
        {editing === 'amount' ? $t('stock.row.invalidAmount') : $t('stock.row.invalidJar')}
      </p>
    {/if}
  </form>
{:else}
  <div
    class="shelf-controls"
    aria-busy={busy}>
    {#if online}
      <button
        bind:this={amountButton}
        type="button"
        class="button shelf-controls__button shelf-controls__amount"
        aria-disabled={busy || undefined}
        aria-label={$t('stock.row.editAmount', { values: { amount: `${$formatNumber(item.quantityG)} g`, glaze: title } })}
        onclick={() => {
          if (!busy) void open('amount');
        }}>
        {$formatNumber(item.quantityG)} g
      </button>
      <button
        bind:this={jarButton}
        type="button"
        class="button shelf-controls__button"
        aria-disabled={busy || undefined}
        aria-label={$t('stock.row.oneJarFor', { values: { glaze: title } })}
        onclick={oneJar}>
        {$t('stock.row.oneJar')}
      </button>
      {#if usedUp && item.canRemove}
        <button
          type="button"
          class="button shelf-controls__button shelf-controls__remove"
          aria-disabled={busy || undefined}
          aria-label={$t('stock.row.removeFor', { values: { glaze: title } })}
          onclick={remove}>
          {$t('stock.row.remove')}
        </button>
      {:else if !usedUp}
        <button
          type="button"
          class="button shelf-controls__button"
          aria-disabled={busy || undefined}
          aria-label={$t('stock.row.usedUpFor', { values: { glaze: title } })}
          onclick={() => run(usedUpInput(item))}>
          {$t('stock.row.usedUp')}
        </button>
      {/if}
    {:else}
      <b class="shelf-controls__static">
        {$formatNumber(item.quantityG)} g
      </b>
    {/if}
  </div>
{/if}

<style>
  .shelf-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    /* Right-aligned in a flex row (shelf row, glaze page entry). */
    margin-left: auto;
  }
  .shelf-controls--edit {
    flex: 1 1 100%;
    align-items: flex-end;
  }
  .shelf-controls__button {
    min-height: var(--touch-target);
    font-size: var(--font-sm);
  }
  /* A write is under way: the buttons keep the focus (`disabled` would drop it to the page) and say they cannot act yet. */
  .shelf-controls__button[aria-disabled='true'] {
    opacity: 0.5;
    cursor: progress;
  }
  .shelf-controls__button.button--primary {
    border-color: var(--accent);
  }
  .shelf-controls__amount {
    min-width: 4.5rem;
    color: var(--accent);
    border-style: dashed;
  }
  .shelf-controls__static {
    color: var(--accent);
    font-size: var(--font-xs);
    white-space: nowrap;
  }
  .shelf-controls__field {
    flex: 1 1 8rem;
    min-width: 0;
    font-size: var(--font-xs);
    font-weight: 550;
  }
  .shelf-controls__field-label {
    display: block;
    overflow-wrap: anywhere;
  }
  .shelf-controls__input {
    margin-top: var(--space-1);
  }
  .shelf-controls__hint,
  .shelf-controls__invalid {
    flex: 1 1 100%;
    margin: 0;
    font-size: var(--font-xs);
  }
  .shelf-controls__hint {
    color: var(--muted);
  }
  .shelf-controls__invalid {
    color: var(--danger-ink);
  }
  @media (pointer: coarse) {
    /* Removing keeps a full touch gap from the buttons that change the amount. */
    .shelf-controls__remove {
      margin-inline-start: calc(var(--touch-gap) - var(--space-2));
    }
    .shelf-controls__field,
    .shelf-controls__static,
    .shelf-controls__hint,
    .shelf-controls__invalid {
      font-size: var(--font-body);
    }
  }
</style>
