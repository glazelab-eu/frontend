<script lang="ts">
  import { errorText, isMessageKey, t } from '../../lib/i18n';

  interface Props {
    /** A server message or message key (`errorText` translates both); '' shows nothing. */
    message: string;
    /** The placeholders of a message key with values (a refused file's size limit); the key is then formatted with them. */
    values?: Record<string, string | number>;
    /** Moves focus to the message when it appears, so keyboard and screen reader users notice it. */
    focus?: boolean;
  }

  let { message, values, focus = true }: Props = $props();
  let element = $state<HTMLElement>();

  $effect(() => {
    if (message && focus) element?.focus();
  });
</script>

{#if message}
  <p
    class="form-error"
    role="alert"
    tabindex="-1"
    bind:this={element}>
    {values && isMessageKey(message) ? $t(message, { values }) : $errorText(message)}
  </p>
{/if}

<style>
  .form-error {
    margin: 0 0 var(--space-3);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--danger-bg);
    color: var(--danger-ink);
    font-size: var(--font-sm);
    font-weight: 600;
  }
</style>
