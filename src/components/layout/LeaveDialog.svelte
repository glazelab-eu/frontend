<script lang="ts">
  import { t, type MessageKey } from '../../lib/i18n';
  import ModalShell from '../ui/ModalShell.svelte';

  interface Props {
    /** The question, such as "Discard this combination?". */
    message: MessageKey;
    /** Replaces the default body ("What you entered has not been saved…") when the question is not about unsaved input. */
    body?: MessageKey;
    /** Replaces the "Discard" button's text and its warning colour: the answer discards nothing. */
    leave?: MessageKey;
    onStay: () => void;
    onDiscard: () => void;
  }

  let { message, body = 'drafts.body', leave, onStay, onDiscard }: Props = $props();
</script>

<ModalShell
  title={$t(message)}
  onClose={onStay}>
  <div class="leave-dialog">
    <p>{$t(body)}</p>
    <div class="button-row leave-dialog__actions">
      <button
        type="button"
        class="button button--primary"
        onclick={onStay}>
        {$t('drafts.stay')}
      </button>
      <button
        type="button"
        class={['button', { 'button--danger': !leave }]}
        onclick={onDiscard}>
        {$t(leave ?? 'drafts.discard')}
      </button>
    </div>
  </div>
</ModalShell>

<style>
  .leave-dialog__actions {
    justify-content: space-between;
    margin-top: var(--space-5);
  }
</style>
