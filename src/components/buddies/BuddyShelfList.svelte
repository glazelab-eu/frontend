<script lang="ts">
  import { flushSync, untrack } from 'svelte';
  import { t, locale } from '../../lib/i18n';
  import type { BuddyName, Glaze } from '../../lib/api/models';
  import { filterGlazes, glazeTitle, idleSlices } from '../../lib/glazes/glazes';
  import { glazeTestTile } from '../../lib/images/pictures';
  import { routeHref } from '../../lib/routing/routes';
  import { SHELF_FILTER_FROM, SHELF_FIRST_ROWS } from '../../lib/stock/shelf';
  import ShelfFilter from '../stock/ShelfFilter.svelte';
  import ShelfGlaze from '../stock/ShelfGlaze.svelte';
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

  /** As on the own shelf (`ShelfList`): the first rows at once, the others in idle slices, as hundreds at once are a long task on a phone. */
  const ROW_SLICE_MS = 10;
  let limit = $state(SHELF_FIRST_ROWS);
  let rowCount = $derived(shown.length);
  $effect.pre(() => {
    const count = rowCount;
    if (count <= untrack(() => limit)) return;
    return idleSlices(() => {
      flushSync(() => (limit += 2));
      return limit >= count;
    }, ROW_SLICE_MS);
  });
</script>

<p class="buddy-shelf__hint">{$t('stock.buddy.hint', { values: { name: buddy.displayName } })}</p>
{#if asOf}
  <p class="buddy-shelf__hint">{$t('buddies.shelf.asOf', { values: { date: asOf } })}</p>
{/if}
{#if filterable}
  <ShelfFilter bind:value={query} />
{/if}
{#if shown.length}
  <ul class="buddy-shelf__list">
    {#each shown.slice(0, limit) as { glaze, title } (glaze.id)}
      <li class="buddy-shelf__row">
        <ShelfGlaze
          {title}
          href={routeHref({ name: 'glaze', id: glaze.id })}
          picture={glazeTestTile(glaze)}
          {userId}>
          <AskBuddy
            {buddy}
            glaze={title}
            title={null}
            link={null}
            {onShare} />
        </ShelfGlaze>
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
  .buddy-shelf__list {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .buddy-shelf__row {
    display: flex;
    border-top: 0.0625rem solid var(--border);
    padding: var(--space-3) 0;
  }
  @media (pointer: coarse) {
    .buddy-shelf__hint {
      font-size: var(--font-body);
    }
  }
</style>
