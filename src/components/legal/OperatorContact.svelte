<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { t } from '../../lib/i18n';
  import { createOperatorContact } from '../../state/legal/operator-contact.svelte';

  interface Props {
    /** Fetches the operator's address; called only by the click, never on render. */
    loadContact: () => Promise<string>;
  }
  let { loadContact }: Props = $props();

  const contact = createOperatorContact(() => loadContact());
  let link: HTMLAnchorElement | undefined = $state();
  onDestroy(contact.clear);

  async function show() {
    await contact.show();
    // The button is replaced by the link: keep the keyboard focus on the result.
    if (contact.status === 'shown') {
      await tick();
      link?.focus();
    }
  }
</script>

<div class="operator-contact">
  {#if contact.status !== 'shown'}
    <button
      class="operator-contact__button"
      type="button"
      aria-disabled={contact.status === 'loading'}
      onclick={show}>
      {$t('account.contact.show')}
    </button>
  {/if}
  <div
    class="operator-contact__result"
    aria-live="polite">
    {#if contact.status === 'shown'}
      <a
        class="operator-contact__link"
        href={`mailto:${contact.email}`}
        bind:this={link}>
        {$t('account.contact', { values: { email: contact.email } })}
      </a>
    {:else if contact.status === 'failed'}
      <span class="operator-contact__failed">{$t('account.contact.failed')}</span>
    {/if}
  </div>
</div>

<style>
  .operator-contact {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    color: var(--muted);
    font-size: var(--font-sm);
  }
  .operator-contact__button {
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-decoration: underline;
    cursor: pointer;
  }
  .operator-contact__link,
  .operator-contact__failed {
    overflow-wrap: anywhere;
  }
  .operator-contact__link {
    color: var(--muted);
  }
  .operator-contact__failed {
    color: var(--danger-ink);
  }
  @media (pointer: coarse) {
    .operator-contact__button,
    .operator-contact__link {
      display: inline-flex;
      align-items: center;
      min-height: var(--touch-target);
    }
  }
</style>
