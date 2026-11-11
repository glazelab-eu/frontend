<script lang="ts">
  import { tick } from 'svelte';
  import { errorText, t } from '../../lib/i18n';
  import type { WishlistInput } from '../../lib/api/inputs';
  import { WISHLIST_NAME_MAX, WISHLIST_NOTE_MAX, wishlistLink } from '../../lib/clubs/wishlist';
  import { FIRST_FIELD } from '../ui/first-field';
  import ModalShell from '../ui/ModalShell.svelte';
  import FormError from '../common/FormError.svelte';
  import OfflineNote from '../common/OfflineNote.svelte';

  interface Props {
    online: boolean;
    /** Why the last submit failed (a server message or key; form `wishlist-add`). */
    error?: string;
    /** Sends the item; resolves true once it is on the wishlist (the dialog then closes). */
    onSubmit: (input: WishlistInput) => Promise<boolean>;
    onClose: () => void;
    /** Whether the form has unsaved input (bind it for the host's leave guard). */
    dirty?: boolean;
  }

  let { online, error = '', onSubmit, onClose, dirty = $bindable(false) }: Props = $props();
  const id = $props.id();
  let name = $state('');
  let link = $state('');
  let note = $state('');
  let busy = $state(false);
  /** The field a check before sending refused, with its message key. */
  let invalid = $state<{ field: 'name' | 'link'; message: string } | null>(null);
  let nameField = $state<HTMLInputElement>();
  let linkField = $state<HTMLInputElement>();

  $effect(() => {
    dirty = Boolean(name.trim() || link.trim() || note.trim());
  });

  async function submit() {
    if (busy || !online) return;
    const checked = wishlistLink(link);
    invalid = !name.trim()
      ? { field: 'name', message: 'errors.wishlistNameRequired' }
      : 'error' in checked
        ? { field: 'link', message: checked.error === 'required' ? 'errors.wishlistLinkRequired' : 'errors.wishlistLinkInvalid' }
        : null;
    if (invalid || 'error' in checked) {
      await tick();
      (invalid?.field === 'name' ? nameField : linkField)?.focus();
      return;
    }
    busy = true;
    try {
      const trimmedNote = note.trim();
      if (await onSubmit({ type: 'ITEM', name: name.trim(), link: checked.link, note: trimmedNote || null })) {
        dirty = false;
        onClose();
      }
    } finally {
      busy = false;
    }
  }
</script>

<ModalShell
  title={$t('clubs.wishlist.itemTitle')}
  initialFocus={FIRST_FIELD}
  onClose={() => !busy && onClose()}>
  <form
    novalidate
    onsubmit={(event) => {
      event.preventDefault();
      void submit();
    }}>
    <label class="form-field">
      {$t('clubs.wishlist.itemName')}
      <input
        bind:this={nameField}
        class="form-field__control"
        bind:value={name}
        maxlength={WISHLIST_NAME_MAX}
        placeholder={$t('clubs.wishlist.itemNamePlaceholder')}
        autocomplete="off"
        required
        aria-invalid={invalid?.field === 'name' || undefined}
        aria-describedby={invalid?.field === 'name' ? `${id}-error` : undefined}
        oninput={() => invalid?.field === 'name' && (invalid = null)} />
      {#if invalid?.field === 'name'}
        {@render fieldError(invalid.message)}
      {/if}
    </label>
    <label class="form-field">
      {$t('clubs.wishlist.link')}
      <input
        bind:this={linkField}
        class="form-field__control"
        type="url"
        inputmode="url"
        bind:value={link}
        placeholder="https://"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        required
        aria-invalid={invalid?.field === 'link' || undefined}
        aria-describedby={invalid?.field === 'link' ? `${id}-link-hint ${id}-error` : `${id}-link-hint`}
        oninput={() => invalid?.field === 'link' && (invalid = null)} />
      <small
        class="wishlist-dialog__hint"
        id="{id}-link-hint">
        {$t('clubs.wishlist.linkHint')}
      </small>
      {#if invalid?.field === 'link'}
        {@render fieldError(invalid.message)}
      {/if}
    </label>
    <label class="form-field">
      {$t('clubs.wishlist.note')}
      <small class="form-field__optional">{$t('common.optional')}</small>
      <input
        class="form-field__control"
        bind:value={note}
        maxlength={WISHLIST_NOTE_MAX}
        placeholder={$t('clubs.wishlist.notePlaceholder')}
        autocomplete="off" />
    </label>
    <FormError message={error} />
    <OfflineNote {online} />
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
        aria-busy={busy || undefined}
        disabled={busy || !online}>
        {$t('clubs.wishlist.submit')}
      </button>
    </div>
  </form>
</ModalShell>

{#snippet fieldError(message: string)}<small
    class="wishlist-dialog__error"
    id="{id}-error"
    role="alert">
    {$errorText(message)}
  </small>{/snippet}

<style>
  .wishlist-dialog__hint {
    display: block;
    margin-top: var(--space-1);
    color: var(--muted);
    font-size: var(--font-xs);
    font-weight: 400;
    overflow-wrap: anywhere;
  }
  .wishlist-dialog__error {
    display: block;
    margin-top: var(--space-1);
    color: var(--danger-ink);
    font-size: var(--font-xs);
    font-weight: 700;
    overflow-wrap: anywhere;
  }
  @media (pointer: coarse) {
    .wishlist-dialog__hint,
    .wishlist-dialog__error {
      font-size: var(--font-body);
    }
  }
</style>
