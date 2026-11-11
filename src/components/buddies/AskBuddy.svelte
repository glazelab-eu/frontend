<script lang="ts">
  import { t } from '../../lib/i18n';
  import type { BuddyName } from '../../lib/api/models';
  import { askMessageKey } from '../../lib/stock/buddy-shelf';
  import ModalShell from '../ui/ModalShell.svelte';

  interface Props {
    buddy: BuddyName;
    /** The glaze's display code and name. */
    glaze: string;
    /** The combination's title, or null on the glaze page: the message then names the glaze alone. */
    title: string | null;
    /** The combination's link, or null where the buddy could not open it (a draft): the message then names the title only. */
    link: string | null;
    /** Shares the message (the system sheet, else a copy); answers it only when the user has to copy it by hand. */
    onShare: (text: string) => Promise<string | null>;
  }

  let { buddy, glaze, title, link, onShare }: Props = $props();
  let manualText = $state<string | null>(null);
  /** The message in the read-only field of the manual copy (a textarea takes a bound value, not a `value` attribute). */
  let manualField = $state('');
  let busy = $state(false);

  /** The message holds its own link: messengers show a shared `text` whole, while some drop a separate `url`. */
  let message = $derived(
    $t(askMessageKey(title, link), {
      values: { name: buddy.displayName, glaze, title: title ?? '', link: link ?? '' },
    }).trim(),
  );

  const selectAll = (event: Event) => (event.currentTarget as HTMLTextAreaElement).select();

  async function ask() {
    if (busy) return;
    busy = true;
    try {
      manualText = await onShare(message);
      manualField = manualText ?? '';
    } finally {
      busy = false;
    }
  }
</script>

<button
  type="button"
  class="ask-buddy"
  disabled={busy}
  aria-label={$t('buddies.shelf.askFor', { values: { name: buddy.displayName, glaze } })}
  onclick={ask}>
  {$t('buddies.shelf.ask', { values: { name: buddy.displayName } })}
</button>
{#if manualText}
  <ModalShell
    title={$t('buddies.shelf.manualTitle')}
    onClose={() => (manualText = null)}>
    <p>{$t('buddies.shelf.manualBody')}</p>
    <label class="form-field">
      {$t('buddies.shelf.manualLabel', { values: { name: buddy.displayName } })}
      <textarea
        class="form-field__control"
        readonly
        rows="4"
        bind:value={manualField}
        onfocus={selectAll}
        onclick={selectAll}>
      </textarea>
    </label>
    <div class="button-row button-row--end ask-buddy__actions">
      <button
        type="button"
        class="button"
        onclick={() => (manualText = null)}>
        {$t('common.close')}
      </button>
    </div>
  </ModalShell>
{/if}

<style>
  .ask-buddy {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    font-size: var(--font-xs);
    font-weight: 700;
    text-decoration: underline;
    text-underline-offset: 0.15em;
    cursor: pointer;
    overflow-wrap: anywhere;
    text-align: start;
  }
  .ask-buddy:disabled {
    cursor: default;
    opacity: 0.6;
  }
  .ask-buddy__actions {
    margin-top: var(--space-4);
  }
  @media (pointer: coarse) {
    .ask-buddy {
      display: inline-flex;
      align-items: center;
      min-width: var(--touch-target);
      min-height: var(--touch-target);
      font-size: var(--font-body);
    }
  }
</style>
