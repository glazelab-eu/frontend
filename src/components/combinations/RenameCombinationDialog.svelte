<script lang="ts">
  import { untrack } from 'svelte';
  import { t } from '../../lib/i18n';
  import { lifetime } from '../../state/shared/lifetime';
  import FormError from '../common/FormError.svelte';
  import OfflineNote from '../common/OfflineNote.svelte';
  import ModalShell from '../ui/ModalShell.svelte';
  import { FIRST_FIELD } from '../ui/first-field';

  interface Props {
    /** The stored title when the dialog opened; a later refresh keeps what was typed. */
    title: string;
    /** A site admin correcting someone else's combination: says so and that the change is logged. */
    correcting: boolean;
    online: boolean;
    /** Why the last save failed (a server message), shown at the save button. */
    error?: string;
    /** Sends the title; resolves true once saved. */
    onSubmit: (title: string) => Promise<boolean>;
    onClose: () => void;
    /** Whether the field differs from the stored title; bind it for the page's leave guard. */
    dirty?: boolean;
  }

  let { title, correcting, online, error = '', onSubmit, onClose, dirty = $bindable(false) }: Props = $props();
  const original = untrack(() => title);
  let draft = $state(untrack(() => title));
  let busy = $state(false);
  let changed = $derived(draft.trim() !== original);
  const life = lifetime();
  $effect(() => {
    dirty = changed;
  });

  async function submit() {
    if (busy || !online) return;
    if (!changed) return onClose();
    const close = onClose;
    busy = true;
    try {
      if ((await onSubmit(draft)) && life.mounted()) {
        dirty = false;
        close();
      }
    } finally {
      if (life.mounted()) busy = false;
    }
  }
</script>

<ModalShell
  title={$t(correcting ? 'combination.correctTitle' : 'combination.rename.title')}
  initialFocus={FIRST_FIELD}
  onClose={() => !busy && onClose()}>
  {#if correcting}
    <p class="rename-combination__body">{$t('combination.correctTitle.body')}</p>
  {/if}
  <form
    onsubmit={(event) => {
      event.preventDefault();
      void submit();
    }}>
    <label class="form-field">
      {$t('studio.titleLabel')}
      <input
        class="form-field__control"
        bind:value={draft}
        maxlength="160"
        autocomplete="off"
        required />
    </label>
    <OfflineNote {online} />
    <FormError message={error} />
    <div class="button-row button-row--end rename-combination__actions">
      <button
        type="button"
        class="button"
        disabled={busy}
        onclick={onClose}>
        {$t('common.cancel')}
      </button>
      <button
        class="button button--primary"
        disabled={busy || !online || !changed}>
        {$t('combination.rename.save')}
      </button>
    </div>
  </form>
</ModalShell>

<style>
  .rename-combination__body {
    margin: 0 0 var(--space-4);
    color: var(--muted);
    font-size: var(--font-sm);
  }
  .rename-combination__actions {
    margin-top: var(--space-4);
  }
</style>
