<script lang="ts">
  import { t, locale } from '../../lib/i18n';
  import type { FeedEntry } from '../../lib/api/models';
  import { entryRoute, entrySentence } from '../../lib/feed/feed';
  import { formatEditedAt } from '../../lib/glazes/glaze-edit';
  import { routeHref } from '../../lib/routing/routes';
  import Avatar from '../avatars/Avatar.svelte';

  interface Props {
    entry: FeedEntry;
    /** Later than the account's seen position (the page groups these under "New"). */
    fresh: boolean;
    /** The actor's picture when the account's lists name it; the initial otherwise. */
    avatarId: string | undefined;
    viewerId: string;
  }

  let { entry, fresh, avatarId, viewerId }: Props = $props();
  let sentence = $derived(entrySentence(entry));
</script>

<!-- One link per entry, to its item; the sentence names who added what (user content is never translated). -->
<li class={['feed-item', { 'feed-item--new': fresh }]}>
  <a
    class="feed-item__link"
    href={routeHref(entryRoute(entry))}>
    <Avatar
      {avatarId}
      name={entry.actorName}
      {viewerId}
      size="sm" />
    <span class="feed-item__body">
      <span class="feed-item__text">{$t(sentence.key, { values: sentence.values })}</span>
      <time
        class="feed-item__time"
        datetime={entry.at}>
        {formatEditedAt(entry.at, $locale ?? 'en')}
      </time>
    </span>
  </a>
</li>

<style>
  .feed-item__link {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: var(--touch-target);
    padding: var(--space-3);
    border: 0.0625rem solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--ink);
    text-decoration: none;
  }
  .feed-item__link:hover {
    border-color: var(--accent);
  }
  .feed-item--new .feed-item__link {
    border-color: var(--accent);
    background: var(--sage);
  }
  .feed-item__body {
    display: grid;
    gap: var(--space-1);
    min-width: 0;
  }
  .feed-item__text {
    overflow-wrap: anywhere;
    line-height: 1.4;
  }
  .feed-item__time {
    color: var(--muted);
    font-size: var(--font-sm);
  }
</style>
