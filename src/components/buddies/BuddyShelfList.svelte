<script lang="ts">
  import { t, locale } from '../../lib/i18n';
  import type { BuddyName, Glaze } from '../../lib/api/models';
  import { filterGlazes, glazeTitle } from '../../lib/glazes/glazes';
  import { coverPosition } from '../../lib/images/photo-focus';
  import { glazeTestTile, pictureSrc } from '../../lib/images/pictures';
  import { routeHref } from '../../lib/routing/routes';
  import { SHELF_FILTER_FROM } from '../../lib/stock/shelf';
  import ImageView from '../images/ImageView.svelte';
  import AskBuddy from './AskBuddy.svelte';

  interface Props {
    buddy: BuddyName;
    /** The glazes the buddy has on their personal shelf (never amounts: the terms' buddy rule). */
    glazes: Glaze[];
    userId: string;
    /** The availability's date, shown offline; undefined online. */
    asOf?: string;
    /** Shares an "Ask" message (the system sheet, else a copy); answers it only when the user has to copy it by hand. */
    onShare: (text: string) => Promise<string | null>;
  }

  let { buddy, glazes, userId, asOf, onShare }: Props = $props();

  let query = $state('');
  let filterable = $derived(glazes.length >= SHELF_FILTER_FROM);
  let collator = $derived(new Intl.Collator($locale ?? 'en', { numeric: true, sensitivity: 'base' }));
  let sorted = $derived(
    glazes.map((glaze) => ({ glaze, title: glazeTitle(glaze) })).sort((a, b) => collator.compare(a.title, b.title) || a.glaze.id.localeCompare(b.glaze.id)),
  );
  let shown = $derived.by(() => {
    if (!filterable || !query.trim()) return sorted;
    const matching = new Set(filterGlazes(glazes, query).map((glaze) => glaze.id));
    return sorted.filter((row) => matching.has(row.glaze.id));
  });
</script>

<p class="buddy-shelf__hint">{$t('stock.buddy.hint', { values: { name: buddy.displayName } })}</p>
{#if asOf}
  <p class="buddy-shelf__hint">{$t('buddies.shelf.asOf', { values: { date: asOf } })}</p>
{/if}
{#if filterable}
  <label class="form-field buddy-shelf__filter">
    {$t('stock.list.filter')}
    <input
      class="form-field__control"
      type="search"
      placeholder={$t('stock.list.filterPlaceholder')}
      bind:value={query} />
  </label>
{/if}
{#if shown.length}
  <ul class="buddy-shelf__list">
    {#each shown as { glaze, title } (glaze.id)}
      {@const picture = glazeTestTile(glaze)}
      <li class="buddy-shelf__row">
        {#if picture}
          <ImageView
            variant="thumbnail"
            src={pictureSrc(picture.image)}
            position={coverPosition(picture.image)}
            {userId}
            alt={$t('images.alt.tile', { values: { title } })} />
        {:else}
          <div
            class="buddy-shelf__icon"
            aria-hidden="true">
            ◒
          </div>
        {/if}
        <div class="buddy-shelf__text">
          <a
            class="buddy-shelf__title"
            href={routeHref({ name: 'glaze', id: glaze.id })}>
            {title}
          </a>
          <AskBuddy
            {buddy}
            glaze={title}
            title={null}
            link={null}
            {onShare} />
        </div>
      </li>
    {/each}
  </ul>
{:else}
  <p class="panel__message">
    {glazes.length ? $t('stock.list.noMatch') : $t('stock.buddy.empty', { values: { name: buddy.displayName } })}
  </p>
{/if}

<style>
  .buddy-shelf__hint {
    margin: 0 0 var(--space-2);
    color: var(--muted);
    font-size: var(--font-xs);
  }
  .buddy-shelf__filter {
    margin-bottom: var(--space-3);
  }
  .buddy-shelf__list {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .buddy-shelf__row {
    display: flex;
    align-items: center;
    gap: var(--space-2-5);
    border-top: 0.0625rem solid var(--border);
    padding: var(--space-3) 0;
  }
  .buddy-shelf__icon {
    width: 3.3125rem;
    height: 3.3125rem;
    border-radius: var(--radius-sm);
    flex: none;
    background: var(--sage);
    color: var(--accent);
    display: grid;
    place-items: center;
    font-size: 1.1875rem;
  }
  .buddy-shelf__text {
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-0-5);
  }
  .buddy-shelf__title {
    font-size: var(--font-sm);
    font-weight: 700;
    color: var(--ink);
    overflow-wrap: anywhere;
  }
  @media (pointer: coarse) {
    .buddy-shelf__hint {
      font-size: var(--font-body);
    }
    .buddy-shelf__title {
      display: flex;
      align-items: center;
      min-height: var(--touch-target);
    }
  }
</style>
