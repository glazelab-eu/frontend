<script lang="ts">
  import { tick } from 'svelte';
  import { t } from '../../lib/i18n';
  import type { FeedEntry } from '../../lib/api/models';
  import type { AppController } from '../../state/app/app-controller';
  import { formErrorFor } from '../../state/app/app-state';
  import { isLoading, progressOf } from '../../lib/sync/lifecycle';
  import { badgeCount, isNew, sourcesOff } from '../../lib/feed/feed';
  import { routeHref } from '../../lib/routing/routes';
  import PageHead from '../../components/ui/PageHead.svelte';
  import SignInEmpty from '../../components/auth/SignInEmpty.svelte';
  import RouteStatus from '../../components/routing/RouteStatus.svelte';
  import OfflineNote from '../../components/common/OfflineNote.svelte';
  import FormError from '../../components/common/FormError.svelte';
  import FeedItem from '../../components/activity/FeedItem.svelte';

  interface Props {
    app: AppController;
  }

  let { app }: Props = $props();
  let appStore = $derived(app.state);
  let user = $derived($appStore.user);
  let online = $derived($appStore.online);
  let error = $derived(formErrorFor($appStore, 'feed'));

  // Page memory only (online only in v1): nothing of the feed is in the snapshot.
  let entries = $state<FeedEntry[]>([]);
  let next = $state<string | null>(null);
  /** The seen position as the first page found it: entries after it stay marked new while the page is shown. */
  let seenAt = $state<string | null>(null);
  let loaded = $state(false);
  let busy = $state(false);
  let failed = $state(false);
  /** The shown page is marked seen: from now on a badge above 0 is news that arrived while the page is open. */
  let watching = $state(false);
  let version = 0;
  /** The "New" heading, which takes the focus from the news button that showed the entries under it. */
  let newHeading = $state<HTMLElement>();
  // Not hidden while "Show more" reads: the status region would announce the same news again.
  let arrived = $derived(watching ? (user?.feedUnread ?? 0) : 0);

  /** Pictures of the people the account already has in its lists (buddies, club members, authors); none for others (the initial). */
  let avatars = $derived.by(() => {
    const ids = new Map<string, string>();
    for (const [id, avatar] of Object.entries($appStore.authorAvatars)) ids.set(id, avatar);
    for (const members of Object.values($appStore.clubMembers)) for (const member of members) if (member.avatarId) ids.set(member.id, member.avatarId);
    for (const buddy of $appStore.buddies.buddies) if (buddy.avatarId) ids.set(buddy.id, buddy.avatarId);
    return ids;
  });
  let fresh = $derived(entries.filter((entry) => isNew(entry, seenAt)));
  let earlier = $derived(entries.filter((entry) => !isNew(entry, seenAt)));
  let noSources = $derived(!!user && !$appStore.buddies.buddies.length && !$appStore.clubs.length);

  async function load(before?: string) {
    const started = version;
    busy = true;
    failed = false;
    const page = await app.loadFeed(before);
    if (started !== version) return;
    busy = false;
    if (!page) {
      failed = true;
      return;
    }
    if (before) {
      const known = new Set(entries.map((entry) => entry.id));
      entries = [...entries, ...page.entries.filter((entry) => !known.has(entry.id))];
    } else {
      entries = page.entries;
      seenAt = page.seenAt ?? null;
      loaded = true;
      const newest = page.entries[0];
      // Seen up to the newest entry shown; one that arrives meanwhile stays new. Never awaited: once it answered, a later badge
      // (the poll's) means something arrived while the page is open, which the "N new" button offers instead of moving the list.
      // Not saved: the badge still counts the entries shown, so nothing is offered as news.
      if (newest && isNew(newest, page.seenAt))
        void app.markFeedSeen(newest.at).then((saved) => {
          if (saved && started === version) watching = true;
        });
      else watching = true;
    }
    next = page.next ?? null;
  }

  /** Who reads: a primitive, so a reload of the same account keeps the page; a new account or a reconnect reads again. */
  let actor = $derived(user && online ? user.id : null);
  let off = $derived(!!user && sourcesOff(user));

  async function showArrived() {
    watching = false;
    // A "Show more" still reading belongs to the list this replaces: its page would land behind the new first page and skip entries.
    const started = ++version;
    await load();
    await tick();
    // The button is gone: the focus goes to what it showed (the last page on a failure, which shows "Try again").
    if (started === version) newHeading?.focus();
  }
  $effect(() => {
    version++;
    entries = [];
    next = null;
    seenAt = null;
    loaded = false;
    busy = false;
    failed = false;
    watching = false;
    // Requests addressed to the account show whatever the sources, so the page reads also with both off (which reads again).
    void off;
    if (actor) void load();
    return () => {
      version++;
    };
  });
</script>

<PageHead
  eyebrow={$t('feed.eyebrow')}
  title={$t('feed.title')}
  description={$t('feed.intro')} />
{#if user}
  <div class="activity">
    {#if !online}
      <OfflineNote
        {online}
        message={$t('feed.offline')} />
    {:else}
      <FormError message={error} />
      <div
        class="activity__arrived"
        role="status">
        {#if arrived}
          <button
            type="button"
            class="button"
            onclick={showArrived}>
            {$t('feed.showNew', { values: { count: badgeCount(arrived) } })}
          </button>
        {/if}
      </div>
      {#if off && entries.length}
        <p class="activity__note">
          {$t('feed.sourcesOff')}
          <a
            class="activity__link"
            href={routeHref({ name: 'account' })}>
            {$t('feed.empty.openSettings')}
          </a>
        </p>
      {/if}
      {#if loaded && !entries.length}
        <p class="empty-state">
          {#if off}
            <span>{$t('feed.empty.allOff')}</span>
            <a
              class="activity__link"
              href={routeHref({ name: 'account' })}>
              {$t('feed.empty.openSettings')}
            </a>
          {:else if noSources}
            <span>{$t('feed.empty.noSources')}</span>
            <span class="activity__links">
              <a
                class="activity__link"
                href={routeHref({ name: 'account' })}>
                {$t('feed.empty.openBuddies')}
              </a>
              <a
                class="activity__link"
                href={routeHref({ name: 'clubs' })}>
                {$t('feed.empty.openClubs')}
              </a>
            </span>
          {:else}
            <span>{$t('feed.empty.nothingNew')}</span>
          {/if}
        </p>
      {:else if !loaded && busy}
        <RouteStatus status="loading" />
      {/if}
      {#if fresh.length}
        <section aria-labelledby="activity-new">
          <h2
            bind:this={newHeading}
            id="activity-new"
            class="activity__heading"
            tabindex="-1">
            {$t('feed.new')}
          </h2>
          <ul class="activity__list">
            {#each fresh as entry (entry.id)}
              <FeedItem
                {entry}
                fresh
                avatarId={avatars.get(entry.actorId)}
                viewerId={user.id} />
            {/each}
          </ul>
        </section>
      {/if}
      {#if earlier.length}
        <section aria-labelledby="activity-earlier">
          <h2
            id="activity-earlier"
            class="activity__heading">
            {$t('feed.earlier')}
          </h2>
          <ul class="activity__list">
            {#each earlier as entry (entry.id)}
              <FeedItem
                {entry}
                fresh={false}
                avatarId={avatars.get(entry.actorId)}
                viewerId={user.id} />
            {/each}
          </ul>
        </section>
      {/if}
      {#if failed || (loaded && next)}
        <!-- A failed page is asked for again: the first, or the one after the entries shown. -->
        <div class="button-row activity__more">
          <button
            type="button"
            class="button"
            disabled={busy}
            onclick={() => load(loaded ? (next ?? undefined) : undefined)}>
            {failed ? $t('common.tryAgain') : $t('feed.showMore')}
          </button>
        </div>
      {/if}
      {#if loaded && entries.length && !next}
        <p class="activity__end">{$t('feed.window')}</p>
      {/if}
    {/if}
  </div>
{:else if isLoading($appStore.sync)}
  <RouteStatus
    status="loading"
    progress={progressOf($appStore.sync)} />
{:else}
  <SignInEmpty
    title={$t('feed.signIn')}
    onSignIn={app.openAuth} />
{/if}

<style>
  .activity {
    max-width: 40rem;
  }
  .activity__heading {
    margin: var(--space-5) 0 var(--space-3);
    font-size: var(--font-md);
    color: var(--muted);
  }
  .activity__list {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .activity__links {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--space-4);
    margin-top: var(--space-3);
  }
  .activity__link {
    color: var(--accent);
    font-weight: 600;
  }
  .activity .empty-state {
    min-height: 10rem;
    gap: var(--space-2);
    margin: 0;
  }
  .activity__arrived:not(:empty) {
    margin-bottom: var(--space-3);
  }
  .activity__note {
    margin: 0 0 var(--space-3);
    color: var(--muted);
    font-size: var(--font-base);
  }
  .activity__more {
    margin-top: var(--space-4);
  }
  .activity__end {
    margin: var(--space-5) 0 0;
    color: var(--muted);
    font-size: var(--font-sm);
  }
  @media (pointer: coarse) {
    .activity__link {
      display: inline-flex;
      align-items: center;
      min-height: var(--touch-target);
    }
  }
</style>
