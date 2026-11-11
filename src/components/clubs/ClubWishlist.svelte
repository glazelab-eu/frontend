<script lang="ts">
  import { tick } from 'svelte';
  import { locale, t } from '../../lib/i18n';
  import type { ClubWishlist, WishlistEntry } from '../../lib/api/models';
  import { isOpen, linkHost, openCount, orderedWishlist, wishlistTitle } from '../../lib/clubs/wishlist';
  import { formatEditedOn } from '../../lib/glazes/glaze-edit';
  import { routeHref } from '../../lib/routing/routes';
  import { createConfirmation } from '../../state/shared/confirmation.svelte';
  import ConfirmDialog from '../common/ConfirmDialog.svelte';
  import FormError from '../common/FormError.svelte';
  import OfflineNote from '../common/OfflineNote.svelte';
  import PanelTitle from '../ui/PanelTitle.svelte';

  interface Props {
    /** The club's wishlist as read this session; undefined until it arrived. */
    wishlist: ClubWishlist | undefined;
    /** How the read went: `loading`, `failed` (with Try again) or `offline` (nothing read yet and no connection). */
    status: 'loading' | 'failed' | 'offline' | 'ready';
    online: boolean;
    /** The failures of the wishlist's own writes (forms `wishlist-remove`, `wishlist-acquired`) and of its read (`wishlist-load`). */
    errors: { load: string; remove: string; acquired: string };
    onRetry: () => void;
    onAddGlaze: () => void;
    onAddItem: () => void;
    /** Removes an entry; answers whether it worked. */
    onRemove: (entry: WishlistEntry) => Promise<boolean>;
    /** Marks an entry acquired or wanted again; answers whether it worked. */
    onAcquired: (entry: WishlistEntry, acquired: boolean) => Promise<boolean>;
  }

  let { wishlist, status, online, errors, onRetry, onAddGlaze, onAddItem, onRemove, onAcquired }: Props = $props();
  let lang = $derived($locale ?? 'en');
  let entries = $derived(wishlist ? orderedWishlist(wishlist.entries) : []);
  let open = $derived(wishlist ? openCount(wishlist.entries) : 0);
  let full = $derived(wishlist ? open >= wishlist.openLimit : false);
  let title = $state<PanelTitle>();
  /** The entry whose state button was pressed: focus follows it when it moves in the list. */
  let toggles: Record<string, HTMLButtonElement | undefined> = $state({});
  let pending = $state('');
  const removal = createConfirmation(async (entry: WishlistEntry) => {
    const removed = await onRemove(entry);
    if (removed) {
      await tick();
      title?.focus();
    }
    return removed;
  });

  /** The pressed button stays focusable while the write runs (`aria-disabled`), and the focus follows its row when it moves. */
  async function toggle(entry: WishlistEntry) {
    if (pending || !online) return;
    pending = entry.id;
    try {
      await onAcquired(entry, isOpen(entry));
    } finally {
      pending = '';
    }
    await tick();
    toggles[entry.id]?.focus();
  }

  const addedLine = (entry: WishlistEntry) =>
    $t('clubs.wishlist.addedBy', { values: { name: entry.addedBy ?? $t('clubs.wishlist.formerMember'), date: formatEditedOn(entry.addedAt, lang) } });
</script>

<section
  class="panel club-wishlist"
  id="club-wishlist">
  <PanelTitle
    bind:this={title}
    title={$t('clubs.wishlist.title')}
    description={wishlist ? $t('clubs.wishlist.count', { values: { count: open, max: wishlist.openLimit } }) : ''} />
  <p class="club-wishlist__intro">{$t('clubs.wishlist.intro')}</p>
  {#if wishlist}
    <OfflineNote
      {online}
      message={$t('clubs.wishlist.offlineShown')} />
    {#if full}
      <p class="club-wishlist__message">{$t('clubs.wishlist.full')}</p>
    {/if}
    <div class="button-row club-wishlist__add">
      <button
        type="button"
        class="button"
        disabled={!online || full}
        onclick={onAddGlaze}>
        {$t('clubs.wishlist.addGlaze')}
      </button>
      <button
        type="button"
        class="button"
        disabled={!online || full}
        onclick={onAddItem}>
        {$t('clubs.wishlist.addItem')}
      </button>
    </div>
    <FormError message={errors.remove || errors.acquired} />
    {#if entries.length}
      <ul class="club-wishlist__list">
        {#each entries as entry (entry.id)}
          {@const name = wishlistTitle(entry)}
          <li class={['club-wishlist__entry', { 'club-wishlist__entry--acquired': !isOpen(entry) }]}>
            <div class="club-wishlist__main">
              {#if entry.type === 'GLAZE' && entry.glazeId}
                <a
                  class="club-wishlist__name club-wishlist__glaze"
                  href={routeHref({ name: 'glaze', id: entry.glazeId })}>
                  {name}
                </a>
              {:else}
                <span class="club-wishlist__name">{name}</span>
                {#if entry.link}
                  <a
                    class="club-wishlist__link"
                    href={entry.link}
                    target="_blank"
                    rel="noopener noreferrer nofollow">
                    {linkHost(entry.link)}
                    <span class="visually-hidden">{$t('clubs.wishlist.newTab')}</span>
                  </a>
                {/if}
              {/if}
              {#if entry.note}
                <p class="club-wishlist__note">{entry.note}</p>
              {/if}
              <p class="club-wishlist__meta">
                <span>{addedLine(entry)}</span>
                {#if entry.acquiredAt}
                  <span class="club-wishlist__acquired">
                    {$t('clubs.wishlist.acquiredOn', { values: { date: formatEditedOn(entry.acquiredAt, lang) } })}
                  </span>
                {/if}
              </p>
            </div>
            {#if entry.canManage}
              <div class="button-row club-wishlist__actions">
                <button
                  type="button"
                  class="button"
                  bind:this={toggles[entry.id]}
                  aria-label={$t(isOpen(entry) ? 'clubs.wishlist.markAcquiredFor' : 'clubs.wishlist.markWantedFor', { values: { name } })}
                  aria-busy={pending === entry.id || undefined}
                  aria-disabled={pending ? 'true' : undefined}
                  disabled={!online}
                  onclick={() => toggle(entry)}>
                  {$t(isOpen(entry) ? 'clubs.wishlist.markAcquired' : 'clubs.wishlist.markWanted')}
                </button>
                <button
                  type="button"
                  class="button"
                  aria-label={$t('clubs.wishlist.removeFor', { values: { name } })}
                  disabled={!online || removal.busy}
                  onclick={() => removal.ask(entry)}>
                  {$t('clubs.wishlist.remove')}
                </button>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {:else}
      <p class="club-wishlist__message">{$t('clubs.wishlist.empty')}</p>
    {/if}
  {:else if status === 'loading'}
    <p
      class="club-wishlist__message"
      role="status">
      {$t('clubs.wishlist.loading')}
    </p>
  {:else if status === 'offline'}
    <p class="club-wishlist__message">{$t('clubs.wishlist.offline')}</p>
  {:else}
    <FormError
      message={errors.load || 'clubs.wishlist.failed'}
      focus={false} />
    <button
      type="button"
      class="button"
      onclick={onRetry}>
      {$t('common.tryAgain')}
    </button>
  {/if}
</section>

{#if removal.asking}
  {@const target = removal.asking}
  <ConfirmDialog
    title={$t('clubs.wishlist.removeTitle', { values: { name: wishlistTitle(target) } })}
    confirmLabel={$t('clubs.wishlist.removeConfirm')}
    {online}
    busy={removal.busy}
    onConfirm={() => void removal.confirm()}
    onCancel={removal.cancel}
    fallbackFocus={() => title?.focus()}>
    <p>{$t('clubs.wishlist.removeBody')}</p>
  </ConfirmDialog>
{/if}

<style>
  .club-wishlist {
    scroll-margin-top: calc(var(--header-height) + var(--space-4));
    margin-top: var(--space-6);
    min-width: 0;
  }
  .club-wishlist__intro,
  .club-wishlist__message {
    color: var(--muted);
    overflow-wrap: anywhere;
    margin-top: 0;
  }
  .club-wishlist__add {
    margin-bottom: var(--space-4);
  }
  .club-wishlist__list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .club-wishlist__entry {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3) 0;
    border-bottom: 0.0625rem solid var(--border);
  }
  .club-wishlist__main {
    flex: 1 1 14rem;
    min-width: 0;
    display: grid;
    gap: var(--space-1);
    overflow-wrap: anywhere;
  }
  .club-wishlist__name {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .club-wishlist__glaze,
  .club-wishlist__link {
    color: var(--accent);
    justify-self: start;
  }
  .club-wishlist__link {
    overflow-wrap: anywhere;
  }
  .club-wishlist__note,
  .club-wishlist__meta {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .club-wishlist__meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0 var(--space-3);
    color: var(--muted);
    font-size: var(--font-sm);
  }
  .club-wishlist__entry--acquired .club-wishlist__name {
    font-weight: 400;
    color: var(--muted);
  }
  .club-wishlist__acquired {
    font-weight: 600;
  }
  .club-wishlist__actions {
    min-width: 0;
  }
  @media (pointer: coarse) {
    .club-wishlist__glaze,
    .club-wishlist__link {
      display: inline-flex;
      align-items: center;
      min-height: var(--touch-target);
    }
    .club-wishlist__meta {
      font-size: var(--font-body);
    }
  }
</style>
