<script lang="ts">
  import { tick } from 'svelte';
  import { t } from '../../lib/i18n';
  import type { BarcodeChange } from '../../lib/api/inputs';
  import { maxBarcodesPerGlaze, normalizeBarcode } from '../../lib/barcodes/barcodes';
  import TagList from '../tags/TagList.svelte';
  import BarcodeScanner from '../scanning/BarcodeScanner.svelte';

  interface Props {
    /** Normalized barcodes of the glaze's packaging. */
    barcodes: string[];
    /** Signed in and online; offline the barcodes are read-only. */
    editable: boolean;
    /** Sends one addition or removal; resolves true when it was saved. */
    onChange: (change: BarcodeChange) => Promise<boolean>;
  }

  let { barcodes, editable, onChange }: Props = $props();
  const id = $props.id();

  let typed = $state('');
  let invalid = $state(false);
  let busy = $state(false);
  let scanning = $state(false);
  let full = $derived(barcodes.length >= maxBarcodesPerGlaze);
  /** The barcodes are read as one line; the editor opens on demand and goes when editing stops being possible. */
  let open = $state(false);
  let editing = $derived(open && editable);
  let editButton = $state<HTMLButtonElement>();
  let field = $state<HTMLInputElement>();
  $effect(() => {
    if (editable) return;
    open = false;
    // The scanner closes with editing and must not turn the camera on again by itself.
    scanning = false;
  });

  async function toggle(next: boolean) {
    open = next;
    await tick();
    if (next) field?.focus();
    else editButton?.focus();
  }

  async function change(next: BarcodeChange) {
    if (busy || !editable) return false;
    busy = true;
    try {
      return await onChange(next);
    } finally {
      busy = false;
    }
  }

  let section = $state<HTMLElement>();

  /** The pressed button goes with its barcode: focus moves to the next remove button, else to the input. */
  async function remove(barcode: string) {
    const index = barcodes.indexOf(barcode);
    if (!(await change({ remove: [barcode] }))) return;
    await tick();
    const buttons = section?.querySelectorAll<HTMLElement>('.tag-list__remove') ?? [];
    (buttons[Math.min(index, buttons.length - 1)] ?? field)?.focus();
  }

  async function add(value: string) {
    const barcode = normalizeBarcode(value);
    invalid = !barcode;
    if (!barcode) return;
    if (barcodes.includes(barcode) || (await change({ add: [barcode] }))) typed = '';
  }
</script>

{#if editable || barcodes.length}
  <section
    bind:this={section}
    class="glaze-barcodes"
    aria-labelledby={id}>
    <div class="glaze-barcodes__line">
      <h2
        class="glaze-barcodes__title"
        {id}>
        {$t('barcodes.label')}
      </h2>
      {#if !editing}
        <span class="glaze-barcodes__values">
          {barcodes.length ? barcodes.join(' · ') : $t('barcodes.none')}
        </span>
      {/if}
      {#if editable}
        <button
          type="button"
          class="glaze-barcodes__toggle"
          bind:this={editButton}
          aria-expanded={editing}
          aria-label={editing ? undefined : $t('barcodes.editLabel')}
          onclick={() => void toggle(!editing)}>
          {editing ? $t('common.done') : $t('barcodes.edit')}
        </button>
      {/if}
    </div>
    {#if editing}
      <TagList
        tags={barcodes}
        label={$t('barcodes.label')}
        removeLabel={(barcode) => $t('barcodes.remove', { values: { barcode } })}
        onRemove={(barcode) => void remove(barcode)} />
      <form
        class="glaze-barcodes__form"
        novalidate
        onsubmit={(event) => {
          event.preventDefault();
          void add(typed);
        }}>
        <label
          class="glaze-barcodes__label"
          for="{id}-input">
          {$t('barcodes.add')}
        </label>
        <div class="glaze-barcodes__row">
          <input
            id="{id}-input"
            bind:this={field}
            class="form-field__control glaze-barcodes__input"
            bind:value={typed}
            oninput={() => (invalid = false)}
            inputmode="numeric"
            autocomplete="off"
            spellcheck="false"
            maxlength="32"
            placeholder={$t('barcodes.placeholder')}
            disabled={full}
            aria-invalid={invalid}
            aria-describedby="{id}-hint" />
          <button
            class="button glaze-barcodes__button"
            disabled={busy || full || !typed.trim()}>
            {$t('barcodes.addButton')}
          </button>
          <button
            type="button"
            class="button glaze-barcodes__button"
            disabled={busy || full}
            onclick={(event) => {
              event.preventDefault();
              scanning = true;
            }}>
            {$t('barcodes.scan')}
          </button>
        </div>
        <small
          class={['glaze-barcodes__hint', { 'glaze-barcodes__hint--invalid': invalid }]}
          id="{id}-hint">
          {invalid
            ? $t('barcodes.invalid')
            : $t('barcodes.count', {
                values: { count: barcodes.length, max: maxBarcodesPerGlaze },
              })}
        </small>
      </form>
    {/if}
  </section>
{/if}
{#if scanning && editable}
  <BarcodeScanner
    title={$t('barcodes.scanner.addTitle')}
    onClose={() => (scanning = false)}
    onBarcode={(barcode) => {
      scanning = false;
      void add(barcode);
    }} />
{/if}

<style>
  /* Stands in the glaze card's right column, like the tags: no frame of its own. */
  .glaze-barcodes {
    margin-top: var(--space-3);
  }
  .glaze-barcodes__line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0 var(--space-3);
  }
  .glaze-barcodes__title {
    margin: 0;
    font-size: var(--font-md);
    font-weight: 700;
  }
  .glaze-barcodes__values {
    min-width: 0;
    overflow-wrap: anywhere;
    font-size: var(--font-sm);
  }
  .glaze-barcodes__toggle {
    min-height: var(--touch-target);
    margin-left: auto;
    padding: 0 var(--space-2);
    border: 0;
    background: none;
    color: var(--accent);
    font-size: var(--font-sm);
    font-weight: 700;
  }
  .glaze-barcodes__form {
    padding-bottom: var(--space-3);
  }
  .glaze-barcodes__label {
    display: block;
    font-size: var(--font-base);
    font-weight: 550;
  }
  .glaze-barcodes__row {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: var(--space-2);
  }
  /* Room for a whole code and its example (LANG-6); the buttons wrap below when they do not fit beside it. */
  .glaze-barcodes__input {
    flex: 1 1 13rem;
    min-width: 0;
  }
  .glaze-barcodes__hint {
    display: block;
    margin-top: var(--space-1);
    color: var(--muted);
    font-size: var(--font-xs);
  }
  .glaze-barcodes__hint--invalid {
    color: var(--danger-ink);
  }
  @media (pointer: coarse) {
    .glaze-barcodes__toggle {
      min-width: var(--touch-target);
    }
    .glaze-barcodes__hint {
      font-size: var(--font-body);
    }
    .glaze-barcodes__form {
      padding-top: var(--space-2);
    }
  }
</style>
