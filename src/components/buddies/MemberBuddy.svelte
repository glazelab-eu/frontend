<script lang="ts">
  import { tick } from 'svelte';
  import { t } from '../../lib/i18n';
  import type { BuddyRelation } from '../../lib/buddies/buddies';

  interface Props {
    /** How the account stands to this member (never `SELF`: the account's own row has no buddy control). */
    relation: BuddyRelation;
    name: string;
    online: boolean;
    /** Asks the member to be buddies; answers whether it worked. */
    onAsk: () => Promise<boolean>;
    /** Accepts the member's request; answers whether it worked. */
    onAccept: () => Promise<boolean>;
  }
  let { relation, name, online, onAsk, onAccept }: Props = $props();
  let busy = $state(false);
  let status = $state<HTMLElement>();

  /** The button turns into text when the request went out, so focus moves to that text instead of falling to the page. */
  async function answered(action: () => Promise<boolean>) {
    if (busy || !online) return;
    busy = true;
    try {
      if (!(await action())) return;
    } finally {
      busy = false;
    }
    await tick();
    status?.focus();
  }
</script>

{#if relation === 'BUDDIES'}
  <span
    class="member-buddy__state"
    tabindex="-1"
    bind:this={status}>
    {$t('clubs.page.buddy.buddies')}
  </span>
{:else if relation === 'OUTGOING'}
  <span
    class="member-buddy__state"
    tabindex="-1"
    bind:this={status}>
    {$t('clubs.page.buddy.sent')}
  </span>
{:else if relation === 'INCOMING'}
  <span class="member-buddy__state">{$t('clubs.page.buddy.asked')}</span>
  <button
    type="button"
    class="button"
    disabled={!online || busy}
    aria-label={$t('buddies.accept.label', { values: { name } })}
    onclick={() => answered(onAccept)}>
    {$t('buddies.accept')}
  </button>
{:else if relation === 'NONE'}
  <button
    type="button"
    class="button"
    disabled={!online || busy}
    aria-label={$t('clubs.page.buddy.askLabel', { values: { name } })}
    onclick={() => answered(onAsk)}>
    {$t('clubs.page.buddy.ask')}
  </button>
{/if}

<style>
  .member-buddy__state {
    color: var(--muted);
    font-size: var(--font-sm);
  }
</style>
