<script lang="ts">
  import Icon from '../ui/Icon.svelte';
  import { t } from '../../lib/i18n';
  import { badgeCount, badgeText } from '../../lib/feed/feed';
  import { routeHref } from '../../lib/routing/routes';

  interface Props {
    /** New activity-feed entries (`User.feedUnread`, read with every load; the saved account's count while offline). */
    count: number;
    /** Buddy requests waiting for an answer: the badge shows them while nothing is new (they wait until answered). */
    requests: number;
    /** The activity page is shown. */
    current: boolean;
  }

  let { count, requests, current }: Props = $props();
  let text = $derived(badgeText(count > 0 ? count : requests));
  let label = $derived(
    count > 0
      ? $t('feed.openUnread', { values: { count: badgeCount(count) } })
      : requests > 0
        ? $t('feed.openRequests', { values: { count: requests } })
        : $t('feed.open'),
  );
</script>

<!-- The app's one badge (FEED-1): new additions by buddies and in the account's clubs, else the buddy requests still waiting. A number
     in a ring, never colour alone; the link's name says the whole sentence. -->
<a
  class="icon-button icon-button--quiet feed-bell"
  href={routeHref({ name: 'activity' })}
  aria-label={label}
  title={label}
  aria-current={current ? 'page' : undefined}>
  <Icon name="bell" />
  {#if text}
    <span
      class="feed-bell__badge"
      aria-hidden="true">
      {text}
    </span>
  {/if}
</a>

<style>
  /* The header row is tight (the one-row wide header from 1120 px with a long name, the 320 px phone bar): 32 px with a fine pointer,
     the touch size below. */
  .feed-bell {
    --icon-size: 1.25rem;
    position: relative;
    width: 2rem;
    height: var(--space-9);
  }
  .feed-bell[aria-current='page'] {
    border-color: currentColor;
  }
  .feed-bell__badge {
    /* Inside the bell's own box (the top corner over the glyph), so the header row never grows with it. */
    position: absolute;
    top: 0;
    right: 0;
    max-width: 100%;
    min-width: 1.125rem;
    height: 1.125rem;
    padding: 0 var(--space-1);
    border: 0.0625rem solid var(--surface);
    border-radius: var(--radius-pill);
    background: var(--danger-ink);
    color: var(--paper);
    font-size: var(--font-xs);
    font-weight: 700;
    line-height: 1rem;
    text-align: center;
    white-space: nowrap;
  }
  @media (pointer: coarse) {
    .feed-bell {
      min-width: var(--touch-target);
      min-height: var(--touch-target);
    }
  }
</style>
