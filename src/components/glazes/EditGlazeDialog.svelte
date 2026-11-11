<script lang="ts">
  import { untrack } from 'svelte';
  import { t, errorText } from '../../lib/i18n';
  import type { Glaze } from '../../lib/api/models';
  import type { GlazeChange } from '../../lib/api/inputs';
  import { glazeCode } from '../../lib/glazes/glazes';
  import { codeMaxLength, glazeErrorField, normalizeCode, validCode, type GlazeField } from '../../lib/glazes/glaze-form';
  import { glazeCorrection, glazeEditDraft, maxGlazeName, maxGlazeNotes } from '../../lib/glazes/glaze-edit';
  import FormError from '../common/FormError.svelte';
  import ModalShell from '../ui/ModalShell.svelte';
  import OfflineNote from '../common/OfflineNote.svelte';

  interface Props {
    glaze: Glaze;
    /** Whether this account may change the code (site admin, or no combination uses the glaze). */
    codeEditable: boolean;
    online: boolean;
    /** Why the last save failed (a server message), shown at its field or at the save button. */
    error?: string;
    /** Sends only what changed; resolves true once saved. */
    onSubmit: (change: GlazeChange) => Promise<boolean>;
    onClose: () => void;
    /** Whether anything differs from the glaze; bind it for the page's leave guard. */
    dirty?: boolean;
  }

  let { glaze, codeEditable, online, error = '', onSubmit, onClose, dirty = $bindable(false) }: Props = $props();
  const id = $props.id();
  /** Starts from the glaze as it was when the dialog opened; a later refresh keeps what was typed. */
  const original = untrack(() => ({ name: glaze.name, code: glaze.code, notes: glaze.notes }));
  let draft = $state(glazeEditDraft(original));
  let busy = $state(false);
  let change = $derived(glazeCorrection(original, draft));
  /** Only a changed code is checked: a stored one (perhaps from before the current rules) stays whatever it is. */
  let codeInvalid = $derived(draft.code !== original.code && normalizeCode(draft.code) !== original.code && !validCode(draft.code));
  $effect(() => {
    dirty = !!change;
  });
  /** A code that became locked (a 403 reloaded a combination using the glaze) goes back to the stored one, so the rest can be saved. */
  $effect(() => {
    if (!codeEditable) untrack(() => (draft.code = original.code));
  });

  let fields = $state<Partial<Record<GlazeField, HTMLInputElement | HTMLTextAreaElement>>>({});
  let errorField = $derived.by(() => {
    const field = error ? glazeErrorField(error) : null;
    return field === 'name' || field === 'code' || field === 'notes' ? field : null;
  });
  $effect(() => {
    if (errorField) fields[errorField]?.focus();
  });
  $effect(() => {
    (fields.code as HTMLInputElement | undefined)?.setCustomValidity(codeInvalid ? $t('glazeForm.codeRules') : '');
  });
  const describedBy = (field: GlazeField, hint = '') => [hint, errorField === field ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;

  async function submit() {
    if (busy || !online || codeInvalid) return;
    if (!change) return onClose();
    busy = true;
    try {
      if (await onSubmit(change)) {
        dirty = false;
        onClose();
      }
    } finally {
      busy = false;
    }
  }
</script>

<ModalShell
  title={$t('glaze.edit.title')}
  onClose={() => !busy && onClose()}>
  <p class="edit-glaze__body">{$t('glaze.edit.body')}</p>
  <p class="edit-glaze__manufacturer">{$t('glaze.edit.manufacturer', { values: { name: glaze.manufacturer.name } })}</p>
  <form
    onsubmit={(event) => {
      event.preventDefault();
      void submit();
    }}>
    <label class="form-field">
      {$t('stock.newGlaze.name')}
      <input
        bind:this={fields.name}
        class="form-field__control"
        bind:value={draft.name}
        maxlength={maxGlazeName}
        aria-invalid={errorField === 'name' || undefined}
        aria-describedby={describedBy('name')}
        required />
      {#if errorField === 'name'}
        {@render fieldError()}
      {/if}
    </label>
    <label class="form-field">
      {$t('stock.newGlaze.code')}
      <input
        bind:this={fields.code}
        class="form-field__control edit-glaze__code"
        bind:value={draft.code}
        maxlength={codeMaxLength * 2}
        autocapitalize="characters"
        spellcheck="false"
        disabled={!codeEditable}
        aria-invalid={errorField === 'code' || codeInvalid || undefined}
        aria-describedby={describedBy('code', codeEditable ? `${id}-code-hint ${id}-code-rules` : `${id}-code-hint`)}
        required />
      <small
        class="edit-glaze__hint"
        id="{id}-code-hint">
        {#if codeEditable}
          {$t('glazeForm.codeShownAs', {
            values: { code: glazeCode({ manufacturer: glaze.manufacturer, code: normalizeCode(draft.code) || '…' }) },
          })}
        {:else}
          {$t('glaze.edit.codeLocked')}
        {/if}
      </small>
      {#if codeEditable}
        <small
          class={['edit-glaze__hint', { 'edit-glaze__hint--invalid': codeInvalid }]}
          id="{id}-code-rules">
          {$t('glazeForm.codeRules')}
        </small>
      {/if}
      {#if errorField === 'code'}
        {@render fieldError()}
      {/if}
    </label>
    <label class="form-field">
      {$t('common.notes')}
      <small class="form-field__optional">{$t('common.optional')}</small>
      <textarea
        bind:this={fields.notes}
        class="form-field__control form-field__control--multiline"
        bind:value={draft.notes}
        maxlength={maxGlazeNotes}
        rows="4"
        aria-invalid={errorField === 'notes' || undefined}
        aria-describedby={describedBy('notes')}>
      </textarea>
      {#if errorField === 'notes'}
        {@render fieldError()}
      {/if}
    </label>
    <OfflineNote {online} />
    <FormError message={errorField ? '' : error} />
    <div class="button-row button-row--end">
      <button
        type="button"
        class="button"
        disabled={busy}
        onclick={onClose}>
        {$t('common.cancel')}
      </button>
      <button
        class="button button--primary"
        disabled={busy || !online || !change}>
        {$t('glaze.edit.save')}
      </button>
    </div>
  </form>
</ModalShell>

{#snippet fieldError()}<small
    class="edit-glaze__error"
    id="{id}-error"
    role="alert">
    {$errorText(error)}
  </small>{/snippet}

<style>
  .edit-glaze__body {
    margin: 0 0 var(--space-2);
    color: var(--muted);
    font-size: var(--font-sm);
  }
  .edit-glaze__manufacturer {
    margin: 0 0 var(--space-4);
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .edit-glaze__code:disabled {
    background: var(--canvas);
    color: var(--muted);
  }
  .edit-glaze__hint {
    display: block;
    margin: var(--space-1) 0 var(--space-1-5);
    color: var(--muted);
    font-size: var(--font-xs);
    font-weight: 400;
  }
  .edit-glaze__hint--invalid {
    color: var(--danger-ink);
  }
  .edit-glaze__error {
    display: block;
    margin-top: var(--space-1);
    color: var(--danger-ink);
    font-size: var(--font-xs);
    font-weight: 700;
  }
  @media (pointer: coarse) {
    .edit-glaze__hint {
      font-size: var(--font-body);
    }
  }
</style>
