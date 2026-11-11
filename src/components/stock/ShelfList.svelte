<script lang="ts">
  import { flushSync, tick, untrack } from 'svelte';
  import { t } from '../../lib/i18n';
  import type { StockWrite } from '../../lib/api/inputs';
  import type { ClubMember, Glaze, StockItem } from '../../lib/api/models';
  import { stockAdder } from '../../lib/clubs/clubs';
  import { idleSlices, referencedGlazeTitle } from '../../lib/glazes/glazes';
  import { glazeTestTile } from '../../lib/images/pictures';
  import { routeHref } from '../../lib/routing/routes';
  import {
    SHELF_FILTER_FROM,
    SHELF_FIRST_ROWS,
    filterShelf,
    firstRows,
    groupShelf,
    isAddition,
    isUsedUp,
    ownerOf,
    shelfRowCount,
    shelfRowLimit,
  } from '../../lib/stock/shelf';
  import OfflineNote from '../common/OfflineNote.svelte';
  import Callout from '../ui/Callout.svelte';
  import Icon from '../ui/Icon.svelte';
  import ShelfRow from './ShelfRow.svelte';

  interface Props {
    stock: StockItem[];
    glazesById: ReadonlyMap<string, Glaze>;
    /** The loaded member lists by club, to name who added a club entry while they are a member. */
    clubMembers: Readonly<Record<string, ClubMember[]>>;
    userId: string;
    online: boolean;
    onSave: (input: StockWrite) => Promise<boolean>;
    onRemove: (id: string) => Promise<boolean>;
    /** "Keep private" of a personal entry (club rows never get the switch). */
    onKeepPrivate?: (id: string, keepPrivate: boolean) => Promise<boolean>;
    /** Said instead of the rows when `stock` (one owner's part of the shelf) holds nothing. */
    empty?: string;
  }

  let { stock, glazesById, clubMembers, userId, online, onSave, onRemove, onKeepPrivate, empty }: Props = $props();

  let query = $state('');
  let root = $state<HTMLElement>();
  let filterable = $derived(stock.length >= SHELF_FILTER_FROM);
  let shown = $derived(filterable ? filterShelf(stock, glazesById, query) : stock);
  let titles = $derived(new Map(stock.map((item) => [item.id, titleOf(item)])));
  let groups = $derived(groupShelf(shown, (item) => titles.get(item.id) ?? ''));

  /** Rows take about as long again to lay out and paint, and that frame has to stay below a long task on a slow phone (16 ms did not). */
  const ROW_SLICE_MS = 10;

  /**
   * How many rows are rendered. A long shelf opens with the first ones and gets the others while the page is idle, as many as
   * an idle slice holds: hundreds of rows at once are a long task on a phone, with their layout. Nothing above a new row moves.
   */
  let limit = $state(SHELF_FIRST_ROWS);
  let rowCount = $derived(shelfRowCount(groups));
  let shownGroups = $derived(firstRows(groups, limit));
  let rowsBefore = 0;
  // Before the DOM changes: a row that joins a whole list never pushes another out, not even for one render.
  $effect.pre(() => {
    const count = rowCount;
    untrack(() => (limit = shelfRowLimit(limit, rowsBefore, count)));
    rowsBefore = count;
    if (count <= untrack(() => limit)) return;
    return idleSlices(() => {
      flushSync(() => (limit += 2));
      return limit >= count;
    }, ROW_SLICE_MS);
  });

  /** Renders every row now: for a scroll to what comes after the list, which later rows would move away again. */
  export function showAll() {
    flushSync(() => (limit = rowCount));
  }

  function titleOf(item: StockItem) {
    return referencedGlazeTitle(glazesById, item);
  }

  /** Where focus goes when a row left its place: the used up group, or the group's heading. */
  async function focusAfter(key: string, id: string, restocked: boolean) {
    await tick();
    const owner = `[data-group="${CSS.escape(key)}"]`;
    const target = restocked
      ? root?.querySelector<HTMLElement>(`[data-stock-id="${CSS.escape(id)}"] button`)
      : root?.querySelector<HTMLElement>(`[data-used-summary="${CSS.escape(key)}"]`);
    (target ?? root?.querySelector<HTMLElement>(owner))?.focus();
  }

  async function save(item: StockItem, input: StockWrite) {
    const ok = await onSave(input);
    // An addition always leaves some on the shelf.
    const usedUpAfter = isAddition(input) ? false : input.quantityG == null ? isUsedUp(item) : input.quantityG <= 0;
    if (ok && isUsedUp(item) !== usedUpAfter) void focusAfter(ownerOf(item), item.id, isUsedUp(item));
    return ok;
  }

  async function remove(item: StockItem) {
    const ok = await onRemove(item.id);
    if (ok) void focusAfter(ownerOf(item), item.id, false);
    return ok;
  }
</script>

<div bind:this={root}>
  <OfflineNote
    {online}
    message={$t('stock.list.offline')} />
  {#if filterable}
    <label class="form-field shelf-filter">
      {$t('stock.list.filter')}
      <input
        class="form-field__control"
        type="search"
        placeholder={$t('stock.list.filterPlaceholder')}
        bind:value={query} />
    </label>
  {/if}
  {#each shownGroups as group (group.key)}
    <section
      class="shelf-group"
      aria-labelledby={`shelf-${group.key}`}>
      {#if group.clubName === null}
        <h3
          class="shelf-group__title"
          id={`shelf-${group.key}`}
          data-group={group.key}
          tabindex="-1">
          {$t('stock.group.personal')}
        </h3>
        {#if onKeepPrivate}
          <p
            class="shelf-group__hint"
            id={`shelf-privacy-${userId}`}>
            {$t('stock.row.keepPrivateHint')}
          </p>
        {/if}
      {:else}
        <!-- A club's entries: the club shelf header's look, with the words "club shelf" and the icon (never the colour alone). -->
        <div class="shelf-group__club">
          <Callout tone="warm">
            {#snippet icon()}<span class="shelf-group__icon"><Icon name="club" /></span>{/snippet}
            <h3
              class="shelf-group__title"
              id={`shelf-${group.key}`}
              data-group={group.key}
              tabindex="-1">
              {$t('stock.group.club', { values: { club: group.clubName } })}
            </h3>
            <p class="shelf-group__hint shelf-group__hint--club">{$t('stock.group.clubHint')}</p>
          </Callout>
        </div>
      {/if}
      {#snippet rows(items: StockItem[])}
        <ul class="shelf-group__list">
          {#each items as item (item.id)}
            <ShelfRow
              {item}
              title={titles.get(item.id) ?? ''}
              href={routeHref({ name: 'glaze', id: item.glazeId })}
              picture={glazeTestTile(glazesById.get(item.glazeId))}
              adder={item.clubId ? stockAdder(item, clubMembers[item.clubId], userId) : null}
              {userId}
              {online}
              onSave={(input) => save(item, input)}
              onRemove={() => remove(item)}
              {onKeepPrivate} />
          {/each}
        </ul>
      {/snippet}
      {#if group.items.length}
        {@render rows(group.items)}
      {/if}
      <!-- Shown with its first used up row; the count is the whole group's while the others still arrive. -->
      {#if group.usedUp.length}
        <details class="shelf-group__used-up">
          <summary
            class="shelf-group__summary"
            data-used-summary={group.key}>
            {$t('stock.group.usedUp', { values: { count: group.usedUpCount } })}
          </summary>
          <!-- A club's used-up rows offer Remove only where `canRemove`; the group hint above says who may. -->
          <p class="shelf-group__hint">
            {$t(group.clubName === null ? 'stock.group.usedUpHint' : 'stock.group.clubUsedUpHint')}
          </p>
          {@render rows(group.usedUp)}
        </details>
      {/if}
    </section>
  {:else}
    <p class="panel__message">{stock.length || !empty ? $t('stock.list.noMatch') : empty}</p>
  {/each}
</div>

<style>
  .shelf-filter {
    margin-bottom: var(--space-3);
  }
  .shelf-group {
    margin-bottom: var(--space-5);
  }
  .shelf-group__club {
    margin-bottom: var(--space-2);
  }
  .shelf-group__icon {
    --icon-size: 1.25rem;
    display: inline-flex;
    color: var(--warm-ink);
  }
  .shelf-group__title {
    margin: 0 0 var(--space-1);
    font-size: var(--font-md);
    font-weight: 700;
    letter-spacing: 0;
  }
  .shelf-group__list {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .shelf-group__used-up {
    margin-top: var(--space-2);
  }
  .shelf-group__summary {
    min-height: var(--touch-target);
    display: list-item;
    list-style-position: inside;
    line-height: var(--touch-target);
    color: var(--muted);
    font-size: var(--font-sm);
    font-weight: 600;
    cursor: pointer;
  }
  .shelf-group__hint {
    margin: 0 0 var(--space-2);
    color: var(--muted);
    font-size: var(--font-xs);
  }
  .shelf-group__hint--club {
    margin-bottom: 0;
  }
  @media (pointer: coarse) {
    .shelf-group__hint {
      font-size: var(--font-body);
    }
  }
</style>
