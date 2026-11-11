<script lang="ts">
  import { tick } from 'svelte';
  import { t, locale } from '../../lib/i18n';
  import type { Buddies, Buddy } from '../../lib/api/models';
  import ScanLinkButton from '../scanning/ScanLinkButton.svelte';
  import Avatar from '../avatars/Avatar.svelte';
  import AvatarReport from '../avatars/AvatarReport.svelte';
  import type { ScannedLink } from '../../lib/scan/scanned-link';
  import { orderedBuddies } from '../../lib/buddies/buddies';
  import { createConfirmation } from '../../state/shared/confirmation.svelte';
  import FormError from '../common/FormError.svelte';
  import ConfirmDialog from '../common/ConfirmDialog.svelte';
  import OfflineNote from '../common/OfflineNote.svelte';
  import AccountSection from '../account/AccountSection.svelte';
  import BuddyLinkPanel from './BuddyLinkPanel.svelte';
  import type { BuddyActions } from './buddy-actions';

  interface Props {
    buddies: Buddies;
    online: boolean;
    /** The last failed row action (accept, decline, cancel, remove) and the last failed link write, from the app's form errors. */
    error: string;
    linkError: string;
    actions: BuddyActions;
    /** The account that looks (the owner of the saved profile pictures). */
    viewerId: string;
    /** Reports a buddy's or requester's profile picture, and why the last report failed (31-3). */
    onReportAvatar: (avatarId: string, reason: string | null) => Promise<boolean>;
    reportError: string;
    /** Opens the route of a scanned buddy link. */
    onScan: (link: ScannedLink) => void;
  }
  let { buddies, online, error, linkError, actions, viewerId, onReportAvatar, reportError, onScan }: Props = $props();
  let listTitle = $state<HTMLElement>();
  const collator = $derived(new Intl.Collator($locale ?? 'en'));
  const mine = $derived(orderedBuddies(buddies.buddies, collator));
  const incoming = $derived(orderedBuddies(buddies.incoming, collator));
  const outgoing = $derived(orderedBuddies(buddies.outgoing, collator));
  let busy = $state(false);

  /** A row leaves the lists when its action worked, taking the focus with its button: it goes to the list's heading. */
  async function answered(action: () => Promise<boolean>) {
    if (busy || !online) return;
    busy = true;
    try {
      if (!(await action())) return;
    } finally {
      busy = false;
    }
    await tick();
    listTitle?.focus();
  }
  const removal = createConfirmation<Buddy>((buddy) => actions.remove(buddy));
  async function remove() {
    if (busy || !online) return;
    busy = true;
    try {
      if (!(await removal.confirm())) return;
    } finally {
      busy = false;
    }
    await tick();
    listTitle?.focus();
  }
</script>

{#snippet picture(buddy: Buddy)}
  <Avatar
    avatarId={buddy.avatarId}
    name={buddy.displayName}
    {viewerId} />
{/snippet}
{#snippet report(buddy: Buddy)}
  <AvatarReport
    avatarId={buddy.avatarId}
    name={buddy.displayName}
    {online}
    error={reportError}
    onReport={onReportAvatar} />
{/snippet}

<AccountSection title={$t('buddies.title')}>
  <p class="buddies__text">{$t('buddies.intro')}</p>
  <OfflineNote
    {online}
    message={$t('buddies.offline')} />
  <FormError message={error} />
  {#if incoming.length}
    <h3 class="buddies__subtitle">{$t('buddies.incoming.title')}</h3>
    <ul class="buddies__list">
      {#each incoming as buddy (buddy.id)}
        <li class="buddies__item">
          {@render picture(buddy)}
          <span class="buddies__name">{buddy.displayName}</span>
          <span class="button-row buddies__actions">
            <button
              type="button"
              class="button button--primary"
              disabled={!online || busy}
              aria-label={$t('buddies.accept.label', { values: { name: buddy.displayName } })}
              onclick={() => answered(() => actions.accept(buddy))}>
              {$t('buddies.accept')}
            </button>
            <button
              type="button"
              class="button"
              disabled={!online || busy}
              aria-label={$t('buddies.decline.label', { values: { name: buddy.displayName } })}
              onclick={() => answered(() => actions.decline(buddy))}>
              {$t('buddies.decline')}
            </button>
            {@render report(buddy)}
          </span>
        </li>
      {/each}
    </ul>
  {/if}
  <h3
    class="buddies__subtitle"
    tabindex="-1"
    bind:this={listTitle}>
    {$t('buddies.list.title')}
  </h3>
  {#if mine.length}
    <ul class="buddies__list">
      {#each mine as buddy (buddy.id)}
        <li class="buddies__item">
          {@render picture(buddy)}
          <span class="buddies__name">{buddy.displayName}</span>
          <span class="button-row buddies__actions">
            <button
              type="button"
              class="button"
              disabled={!online || busy}
              aria-label={$t('buddies.remove.label', { values: { name: buddy.displayName } })}
              onclick={() => removal.ask(buddy)}>
              {$t('buddies.remove')}
            </button>
            {@render report(buddy)}
          </span>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="buddies__text">{$t('buddies.list.empty')}</p>
  {/if}
  {#if outgoing.length}
    <h3 class="buddies__subtitle">{$t('buddies.outgoing.title')}</h3>
    <ul class="buddies__list">
      {#each outgoing as buddy (buddy.id)}
        <li class="buddies__item">
          {@render picture(buddy)}
          <span class="buddies__name">
            {buddy.displayName}
            <span class="buddies__note">{$t('buddies.outgoing.waiting')}</span>
          </span>
          <span class="button-row buddies__actions">
            <button
              type="button"
              class="button"
              disabled={!online || busy}
              aria-label={$t('buddies.cancel.label', { values: { name: buddy.displayName } })}
              onclick={() => answered(() => actions.cancel(buddy))}>
              {$t('buddies.cancel')}
            </button>
            {@render report(buddy)}
          </span>
        </li>
      {/each}
    </ul>
  {/if}
  <p class="buddies__scan">
    <ScanLinkButton
      label={$t('buddies.scan')}
      refusal={$t('buddies.scan.refused')}
      kinds={['buddy']}
      onOpen={onScan} />
  </p>
  <BuddyLinkPanel
    hasLink={buddies.hasLink}
    {online}
    error={linkError}
    {actions} />
</AccountSection>
{#if removal.asking}
  {@const buddy = removal.asking}
  <ConfirmDialog
    title={$t('buddies.remove.title', { values: { name: buddy.displayName } })}
    confirmLabel={$t('buddies.remove.confirm')}
    {online}
    offlineMessage={$t('buddies.offline')}
    confirmDisabled={busy}
    onConfirm={remove}
    onCancel={removal.cancel}>
    <p class="buddies__dialog-body">{$t('buddies.remove.body', { values: { name: buddy.displayName } })}</p>
  </ConfirmDialog>
{/if}

<style>
  .buddies__scan {
    margin: var(--space-4) 0 0;
  }
  .buddies__text {
    margin: 0 0 var(--space-4);
    color: var(--muted);
    font-size: var(--font-base);
    line-height: 1.6;
  }
  .buddies__subtitle {
    margin: var(--space-6) 0 var(--space-2);
    font-size: var(--font-base);
    font-weight: 650;
  }
  .buddies__list {
    list-style: none;
    margin: 0 0 var(--space-3);
    padding: 0;
  }
  .buddies__item {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2) var(--space-3);
    padding: var(--space-2) 0;
    border-bottom: 0.0625rem solid var(--border);
  }
  .buddies__name {
    flex: 1 1 8rem;
    min-width: 0;
    overflow-wrap: anywhere;
    font-weight: 600;
  }
  .buddies__note {
    display: block;
    color: var(--muted);
    font-size: var(--font-sm);
    font-weight: 400;
  }
  .buddies__actions {
    align-items: center;
  }
  /* A display name may be one word of 100 characters: it wraps instead of being clipped by the dialog. */
  .buddies__dialog-body {
    overflow-wrap: anywhere;
  }
</style>
