<script lang="ts">
  import { t } from '../../lib/i18n';
  import type { Glaze } from '../../lib/api/models';
  import type { WishlistInput } from '../../lib/api/inputs';
  import { WISHLIST_NOTE_MAX } from '../../lib/clubs/wishlist';
  import { FIRST_FIELD } from '../ui/first-field';
  import ModalShell from '../ui/ModalShell.svelte';
  import FormError from '../common/FormError.svelte';
  import OfflineNote from '../common/OfflineNote.svelte';
  import GlazePicker from '../glazes/GlazePicker.svelte';

  interface Props {
    /** The loaded library, offered by manufacturer, code and name. */
    glazes: Glaze[];
    /** Whether a glaze is wanted on this wishlist already (the API refuses a second open entry). */
    wished: (glazeId: string) => boolean;
    online: boolean;
    /** Why the last submit failed (a server message or key; form `wishlist-add`). */
    error?: string;
    /** The chosen glaze; the host sets it to a glaze it just added to the library. */
    glazeId?: string;
    /** Opens the add-glaze dialog for a glaze not in the library yet (above this one). */
    onAddGlaze: () => void;
    /** Sends the entry; resolves true once it is on the wishlist (the dialog then closes). */
    onSubmit: (input: WishlistInput) => Promise<boolean>;
    onClose: () => void;
    /** Whether the form has unsaved input (bind it for the host's leave guard). */
    dirty?: boolean;
  }

  let { glazes, wished, online, error = '', glazeId = $bindable(''), onAddGlaze, onSubmit, onClose, dirty = $bindable(false) }: Props = $props();
  let note = $state('');
  let busy = $state(false);
  /** A check before sending: no glaze chosen, or one already wanted. */
  let refused = $state('');

  $effect(() => {
    dirty = Boolean(glazeId || note.trim());
  });

  async function submit() {
    if (busy || !online) return;
    refused = !glazeId ? 'errors.wishlistGlazeRequired' : wished(glazeId) ? 'errors.wishlistAlreadyWished' : '';
    if (refused) return;
    busy = true;
    try {
      const trimmedNote = note.trim();
      if (await onSubmit({ type: 'GLAZE', glazeId, note: trimmedNote || null })) {
        dirty = false;
        onClose();
      }
    } finally {
      busy = false;
    }
  }
</script>

<ModalShell
  title={$t('clubs.wishlist.glazeTitle')}
  initialFocus={FIRST_FIELD}
  onClose={() => !busy && onClose()}>
  <form
    novalidate
    onsubmit={(event) => {
      event.preventDefault();
      void submit();
    }}>
    <GlazePicker
      {glazes}
      selectedId={glazeId}
      onSelect={(id) => {
        glazeId = id;
        refused = '';
      }}
      label={$t('clubs.wishlist.glaze')}
      placeholder={$t('stock.form.glazePlaceholder')}
      onAdd={online ? onAddGlaze : undefined} />
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
    <FormError message={refused || error} />
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
