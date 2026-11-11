<script lang="ts">
  import ShelfSelect from '../stock/ShelfSelect.svelte';
  import { untrack } from 'svelte';
  import { t, errorText } from '../../lib/i18n';
  import type { Club, Glaze } from '../../lib/api/models';
  import type { GlazeInput } from '../../lib/api/inputs';
  import { glazeCode, glazeTitle, manufacturersOf } from '../../lib/glazes/glazes';
  import {
    codeMaxLength,
    duplicateGlaze,
    similarGlazes,
    normalizeCode,
    validCode,
    newManufacturerDraft,
    withExistingManufacturer,
    codePrefix,
    draftOwnerFor,
    emptyGlazeDraft,
    glazeErrorField,
    glazeInput,
    maxJarSizeG,
    shelfTyped,
    validShelf,
    type GlazeField,
    shortIdPattern,
    withManufacturerName,
    withLabel,
  } from '../../lib/glazes/glaze-form';
  import { withPendingTag, withTag, type TagCount } from '../../lib/tags/tags';
  import { normalizeBarcode } from '../../lib/barcodes/barcodes';
  import { canTakeBarcode } from '../../lib/barcodes/add-flow';
  import ManufacturerPicker from './ManufacturerPicker.svelte';
  import TagEditor from '../tags/TagEditor.svelte';
  import FormError from '../common/FormError.svelte';
  import OfflineNote from '../common/OfflineNote.svelte';
  import LabelScanner from '../scanning/LabelScanner.svelte';
  import { routeHref } from '../../lib/routing/routes';

  interface Props {
    accountId: string;
    /** The loaded listing; its manufacturers fill the picker. */
    glazes: Glaze[];
    /** Tags of the loaded listings, suggested for the new glaze. */
    tagCounts: TagCount[];
    online: boolean;
    /** The clubs whose shelf can hold the glaze (the "I have this glaze" section). */
    clubs?: Club[];
    /** Whether "I have this glaze" starts on: from the stock page and from scans. */
    shelf?: boolean;
    /** The shelf the section starts on ("personal" or a club's ID; the host's shown or chosen shelf), else the personal one. */
    owner?: string;
    /** Resolves true when the glaze was added. */
    onSubmit: (input: GlazeInput) => Promise<boolean>;
    /** What a duplicate offers beside "Open it", such as selecting it; without one, its stock link. */
    existingAction?: { label: string; run: (glaze: Glaze) => void };
    /**
     * The dialog was opened for a scanned barcode no glaze has: an existing glaze (the duplicate or a similar hint)
     * that can take it offers "Add barcode … to …", which `run` carries out.
     */
    scanned?: { barcode: string; run: (glaze: Glaze) => Promise<void> };
    /** The packaging's barcode; bind it so a scan can pre-fill it. Cleared after a success. */
    barcode?: string;
    /** Why the last submit failed (a server message), shown at its field or at the submit button. */
    error?: string;
    /** Whether anything was typed or chosen (a pre-filled barcode does not count); bind it. */
    dirty?: boolean;
  }

  let {
    accountId,
    glazes,
    tagCounts,
    online,
    onSubmit,
    clubs = [],
    shelf = false,
    owner,
    existingAction,
    scanned,
    barcode = $bindable(''),
    error = '',
    dirty = $bindable(false),
  }: Props = $props();
  const id = $props.id();

  /** A new draft: the section on as the host says, on the host's shelf while the account is in its club. */
  const freshDraft = () => untrack(() => emptyGlazeDraft(shelf, draftOwnerFor(owner, clubs)));
  let draft = $state(freshDraft());
  let readingLabel = $state(false);
  let previousAccount = untrack(() => accountId);
  $effect(() => {
    if (accountId === previousAccount) return;
    previousAccount = accountId;
    readingLabel = false;
    draft = freshDraft();
    barcode = '';
    typed = tagText = '';
    barcodeBeforeEdit = null;
  });
  // A club the account left meanwhile is no shelf to write to: back to the personal one, never another club.
  $effect(() => {
    if (draft.owner && !clubs.some((club) => club.id === draft.owner)) draft.owner = '';
  });
  let busy = $state(false);
  /** What was last typed into the picker, offered as the name of a new manufacturer. */
  let typed = $state('');
  /** Typed in the tag field but not added yet; saved with the glaze. */
  let tagText = $state('');
  /** Capture the value before the first edit; barcode pre-fills alone are not unsaved input. */
  let barcodeBeforeEdit = $state<string | null>(null);
  let manufacturers = $derived(manufacturersOf(glazes));
  $effect(() => {
    dirty = !!(
      draft.manufacturerId ||
      draft.newManufacturer ||
      typed.trim() ||
      draft.name.trim() ||
      draft.code.trim() ||
      draft.notes.trim() ||
      draft.tags.length ||
      tagText.trim() ||
      shelfTyped(draft) ||
      (barcodeBeforeEdit !== null && barcode !== barcodeBeforeEdit)
    );
  });
  let prefix = $derived(codePrefix(draft, manufacturers));
  let normalizedCode = $derived(normalizeCode(draft.code));
  let codeInvalid = $derived(!!draft.code && !validCode(draft.code));
  let duplicate = $derived(duplicateGlaze(glazes, draft));
  let similar = $derived(duplicate ? [] : similarGlazes(glazes, draft));
  let barcodeInput = $state<HTMLInputElement>();
  let taking = $state(false);
  /** The glazes (the duplicate, else the similar hints) that can take the scanned barcode. */
  let takers = $derived((duplicate ? [duplicate] : similar).filter((glaze) => canTakeBarcode(glaze, scanned?.barcode ?? '')));
  async function take(glaze: Glaze) {
    if (!scanned || taking) return;
    taking = true;
    try {
      await scanned.run(glaze);
    } finally {
      taking = false;
    }
  }
  /** The inputs a known server error can point to; the others show it at the submit button. */
  let fields = $state<Partial<Record<GlazeField, HTMLInputElement>>>({});
  let errorField = $derived.by(() => {
    const field = error ? glazeErrorField(error) : null;
    return field && (field !== 'barcode' ? fields[field] : barcodeInput) ? field : null;
  });
  $effect(() => {
    if (errorField) (errorField === 'barcode' ? barcodeInput : fields[errorField])?.focus();
  });
  const invalid = (field: GlazeField) => (errorField === field ? true : undefined);
  const describedBy = (field: GlazeField, hint = '') => [hint, errorField === field ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
  $effect(() => {
    barcodeInput?.setCustomValidity(barcode.trim() && !normalizeBarcode(barcode) ? $t('barcodes.invalid') : '');
  });

  $effect(() => {
    fields.code?.setCustomValidity(codeInvalid ? $t('glazeForm.codeRules') : '');
  });

  function addManufacturer() {
    draft = newManufacturerDraft(draft, typed, manufacturers);
    typed = '';
  }

  async function submit() {
    if (busy || !online || duplicate || !validCode(draft.code) || !validShelf(draft)) return;
    const tags = withPendingTag(draft.tags, tagText);
    if (!tags) return;
    draft.tags = tags;
    tagText = '';
    busy = true;
    try {
      if (await onSubmit(glazeInput(draft, barcode))) {
        draft = freshDraft();
        barcode = '';
        barcodeBeforeEdit = null;
        typed = '';
      }
    } finally {
      busy = false;
    }
  }
</script>

<form
  class="glaze-form"
  onsubmit={(event) => {
    event.preventDefault();
    submit();
  }}>
  <div class="glaze-form__label">
    <button
      type="button"
      class="button"
      disabled={busy}
      onclick={() => (readingLabel = true)}>
      {$t('ocr.open')}
    </button>
  </div>
  <div class="glaze-form__manufacturer">
    {#if draft.newManufacturer}
      <div class="form-row">
        <label class="form-field">
          {$t('glazeForm.newManufacturerName')}
          <input
            bind:this={fields.manufacturerName}
            class="form-field__control"
            aria-invalid={invalid('manufacturerName')}
            aria-describedby={describedBy('manufacturerName')}
            value={draft.manufacturerName}
            oninput={(event) => (draft = withManufacturerName(draft, event.currentTarget.value))}
            placeholder={$t('glazeForm.newManufacturerPlaceholder')}
            maxlength="100"
            required />
          {#if errorField === 'manufacturerName'}
            {@render fieldError()}
          {/if}
        </label>
        <label class="form-field">
          {$t('glazeForm.shortId')}
          <input
            bind:this={fields.shortId}
            class="form-field__control"
            aria-invalid={invalid('shortId')}
            value={draft.shortId}
            oninput={(event) => {
              draft.shortId = event.currentTarget.value;
              draft.shortIdEdited = true;
            }}
            placeholder={$t('glazeForm.shortIdPlaceholder')}
            pattern={shortIdPattern}
            maxlength="10"
            autocapitalize="characters"
            spellcheck="false"
            title={$t('glazeForm.shortIdHint')}
            aria-describedby={describedBy('shortId', `${id}-short-id-hint`)}
            required />
          {#if errorField === 'shortId'}
            {@render fieldError()}
          {/if}
        </label>
      </div>
      <p
        class="glaze-form__hint"
        id="{id}-short-id-hint">
        {$t('glazeForm.shortIdHint')}
      </p>
      <button
        class="glaze-form__switch"
        type="button"
        onclick={() => (draft = { ...draft, newManufacturer: false })}>
        {$t('glazeForm.chooseManufacturer')}
      </button>
    {:else}
      <ManufacturerPicker
        {manufacturers}
        selectedId={draft.manufacturerId}
        onSelect={(manufacturerId) => {
          draft = withExistingManufacturer(draft, manufacturerId);
          if (manufacturerId) typed = '';
        }}
        onText={(text) => (typed = text)} />
      <button
        class="glaze-form__switch"
        type="button"
        onclick={addManufacturer}>
        {$t('glazeForm.addManufacturer')}
      </button>
    {/if}
  </div>
  <label class="form-field">
    {$t('stock.newGlaze.name')}
    <input
      bind:this={fields.name}
      class="form-field__control"
      aria-invalid={invalid('name')}
      aria-describedby={describedBy('name', similar.length ? id + '-similar' : '')}
      bind:value={draft.name}
      placeholder={$t('stock.newGlaze.namePlaceholder')}
      maxlength="120"
      required />
    {#if errorField === 'name'}
      {@render fieldError()}
    {/if}
    {#if similar.length}
      <span
        class="glaze-form__similar"
        id={id + '-similar'}>
        <span>{$t('glazeForm.similar')}</span>
        {#each similar as glaze (glaze.id)}
          <a href={routeHref({ name: 'glaze', id: glaze.id })}>
            {glazeTitle(glaze)}
          </a>
        {/each}
      </span>
    {/if}
  </label>
  <label class="form-field">
    {$t('stock.newGlaze.code')}
    <span class="glaze-form__code">
      <span
        class="glaze-form__prefix"
        aria-hidden="true">
        {prefix || '…'}
      </span>
      <input
        bind:this={fields.code}
        class="form-field__control"
        aria-invalid={invalid('code') || codeInvalid || undefined}
        bind:value={draft.code}
        placeholder={$t('stock.newGlaze.codePlaceholder')}
        maxlength={codeMaxLength * 2}
        autocapitalize="characters"
        spellcheck="false"
        title={$t('stock.newGlaze.codeHint')}
        aria-describedby={describedBy('code', id + '-code-hint ' + id + '-code-rules')}
        required />
    </span>
    {#if errorField === 'code'}
      {@render fieldError()}
    {/if}
    <small
      class="glaze-form__hint"
      id="{id}-code-hint">
      {prefix
        ? $t('glazeForm.codeShownAs', {
            values: {
              code: glazeCode({
                manufacturer: { name: prefix },
                code: normalizedCode || '…',
              }),
            },
          })
        : $t('glazeForm.codeExample')}
    </small>
    <small
      class={['glaze-form__hint', { 'glaze-form__hint--invalid': codeInvalid }]}
      id={id + '-code-rules'}>
      {$t('glazeForm.codeRules')}
    </small>
  </label>
  <label class="form-field">
    {$t('common.notes')}
    <small class="form-field__optional">{$t('common.optional')}</small>
    <input
      bind:this={fields.notes}
      class="form-field__control"
      aria-invalid={invalid('notes')}
      aria-describedby={describedBy('notes')}
      bind:value={draft.notes}
      maxlength="1000"
      placeholder={$t('stock.newGlaze.notesPlaceholder')} />
    {#if errorField === 'notes'}
      {@render fieldError()}
    {/if}
  </label>
  <label class="form-field">
    {$t('barcodes.field')}
    <small class="form-field__optional">{$t('common.optional')}</small>
    <input
      bind:this={barcodeInput}
      class="form-field__control"
      value={barcode}
      oninput={(event) => {
        barcodeBeforeEdit ??= barcode;
        barcode = event.currentTarget.value;
      }}
      inputmode="numeric"
      autocomplete="off"
      spellcheck="false"
      maxlength="32"
      placeholder={$t('barcodes.placeholder')}
      aria-invalid={invalid('barcode')}
      aria-describedby={describedBy('barcode', `${id}-barcode-hint`)} />
    <small
      class="glaze-form__hint"
      id="{id}-barcode-hint">
      {$t('barcodes.hint')}
    </small>
    {#if errorField === 'barcode'}
      {@render fieldError()}
    {/if}
  </label>
  <div class="glaze-form__tags">
    <TagEditor
      tags={draft.tags}
      suggestions={tagCounts}
      onAdd={(tag) => {
        draft.tags = withTag(draft.tags, tag);
        return true;
      }}
      onRemove={(tag) => {
        draft.tags = draft.tags.filter((other) => other !== tag);
        return true;
      }}
      addOnSave
      bind:text={tagText} />
  </div>
  <div class="glaze-form__shelf">
    <label class="glaze-form__have">
      <input
        class="glaze-form__have-input"
        type="checkbox"
        bind:checked={draft.have} />
      {$t('glazeForm.shelf.have')}
    </label>
    {#if draft.have}
      <div class="form-row glaze-form__amounts">
        <label class="form-field">
          {$t('glazeForm.shelf.quantity')}
          <input
            class="form-field__control"
            type="number"
            inputmode="numeric"
            min="0"
            step="1"
            bind:value={draft.quantity}
            required />
        </label>
        <label class="form-field">
          {$t('glazeForm.shelf.jarSize')}
          <small class="form-field__optional">{$t('common.optional')}</small>
          <input
            class="form-field__control"
            type="number"
            inputmode="numeric"
            min="1"
            max={maxJarSizeG}
            step="1"
            bind:value={draft.jarSize} />
        </label>
      </div>
      {#if clubs.length}
        <!-- The draft's personal shelf is the empty owner. -->
        <ShelfSelect
          value={draft.owner || 'personal'}
          {clubs}
          onChange={(owner) => (draft.owner = owner === 'personal' ? '' : owner)} />
      {/if}
    {/if}
  </div>
  <div class="glaze-form__footer">
    <OfflineNote {online} />
    <FormError message={errorField ? '' : error} />
    {#if !duplicate && takers.length}
      <div class="button-row">
        {#each takers as glaze (glaze.id)}
          <button
            type="button"
            class="button"
            disabled={taking || !online}
            onclick={() => void take(glaze)}>
            {$t('glazeForm.takeBarcode', { values: { barcode: scanned!.barcode, glaze: glazeTitle(glaze) } })}
          </button>
        {/each}
      </div>
    {/if}
    {#if duplicate}
      {@const existing = duplicate}
      <p
        class="glaze-form__duplicate"
        role="status">
        {$t('glazeForm.duplicate', { values: { glaze: glazeTitle(existing) } })}
      </p>
      <div class="button-row">
        <a
          class="button"
          href={routeHref({ name: 'glaze', id: existing.id })}>
          {$t('glazeForm.openDuplicate')}
        </a>
        {#if takers.length}
          <button
            type="button"
            class="button button--primary"
            disabled={taking || !online}
            onclick={() => void take(existing)}>
            {$t('glazeForm.takeBarcode', { values: { barcode: scanned!.barcode, glaze: glazeTitle(existing) } })}
          </button>
        {/if}
        {#if existingAction}
          <button
            type="button"
            class={['button', { 'button--primary': !takers.length }]}
            disabled={busy}
            onclick={() => existingAction.run(existing)}>
            {existingAction.label}
          </button>
        {:else}
          <a
            class={['button', { 'button--primary': !takers.length }]}
            href={routeHref({ name: 'stock', glaze: existing.id })}>
            {$t('glazeForm.addToShelf')}
          </a>
        {/if}
      </div>
    {:else}
      <button
        class="button glaze-form__submit button--primary"
        disabled={busy || !online}>
        {$t('stock.newGlaze.submit')}
      </button>
    {/if}
  </div>
</form>
{#if readingLabel}
  <LabelScanner
    {glazes}
    initial={{ manufacturer: prefix, name: draft.name, code: draft.code }}
    onClose={() => (readingLabel = false)}
    onConfirm={(label) => (draft = withLabel(draft, label, manufacturers))} />
{/if}

{#snippet fieldError()}<small
    class="glaze-form__error"
    id="{id}-error"
    role="alert">
    {$errorText(error)}
  </small>{/snippet}

<style>
  .glaze-form {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0 var(--space-4);
  }
  .glaze-form__label {
    grid-column: 1 / -1;
    margin-bottom: var(--space-4);
  }
  .glaze-form__manufacturer {
    margin-bottom: var(--space-4);
  }
  .glaze-form__switch {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font-size: var(--font-sm);
    font-weight: 700;
  }
  .glaze-form__hint {
    display: block;
    margin: var(--space-1) 0 var(--space-1-5);
    color: var(--muted);
    font-size: var(--font-xs);
    font-weight: 400;
  }
  .glaze-form__hint--invalid {
    color: var(--danger-ink);
  }
  .glaze-form__similar {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin-top: var(--space-1-5);
    font-size: var(--font-xs);
    color: var(--muted);
  }
  .glaze-form__duplicate {
    margin: 0 0 var(--space-3);
    color: var(--accent);
    font-size: var(--font-base);
  }
  .glaze-form__code {
    display: flex;
    align-items: baseline;
    gap: var(--space-1);
  }
  .glaze-form__prefix {
    flex: none;
    max-width: 50%;
    overflow-wrap: anywhere;
    color: var(--muted);
    font-size: var(--font-md);
    font-weight: 700;
  }
  .glaze-form__tags {
    grid-column: 1 / -1;
  }
  .glaze-form__shelf {
    grid-column: 1 / -1;
    margin-top: var(--space-4);
  }
  .glaze-form__amounts {
    /* The jar size label carries the optional hint and may wrap: the inputs share the row's bottom. */
    align-items: end;
  }
  .glaze-form__have {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--touch-target);
    font-size: var(--font-base);
    font-weight: 700;
  }
  .glaze-form__have-input {
    flex: none;
    width: 1.25rem;
    height: 1.25rem;
    margin: 0;
    accent-color: var(--accent);
  }
  .glaze-form__footer {
    grid-column: 1 / -1;
    margin-bottom: var(--space-4);
  }
  .glaze-form__error {
    display: block;
    margin-top: var(--space-1);
    color: var(--danger-ink);
    font-size: var(--font-xs);
    font-weight: 700;
  }
  @media (width < 45em) {
    .glaze-form {
      grid-template-columns: 1fr;
    }
  }
  @media (pointer: coarse) {
    .glaze-form__hint,
    .glaze-form__similar,
    .glaze-form__error {
      font-size: var(--font-body);
    }
    .glaze-form__switch {
      display: inline-flex;
      align-items: center;
      min-height: var(--touch-target);
    }
    .glaze-form__footer {
      margin-top: var(--space-3);
    }
  }
</style>
