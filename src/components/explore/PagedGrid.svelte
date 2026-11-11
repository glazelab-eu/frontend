<script
  lang="ts"
  generics="T">
  import { tick, untrack, type Snippet } from 'svelte';
  import { t } from '../../lib/i18n';
  import {
    canObserve,
    documentTop,
    nextPage,
    packInRows,
    pageSize,
    restoredScrollY,
    savedPosition,
    shownCount,
    whenNearView,
    withPosition,
    type Paging,
  } from '../../lib/paging/paging';

  interface Props {
    items: T[];
    itemKey: (item: T) => string;
    card: Snippet<[T]>;
    /** Names the list in the history entry, so back navigation returns to the same place. */
    name: string;
    /** Changes when search or filters change; the list then starts again at its first page. */
    filterKey: string;
    /** Offered only once every eligible card has rendered. The callback appends a page and focuses its first link. */
    end?: Snippet<[(reveal: () => void) => Promise<void>]>;
  }

  let { items, itemKey, card, name, filterKey, end }: Props = $props();

  const restored = savedPosition(
    history.state,
    untrack(() => name),
  );
  let paging = $state<Paging>({
    key: untrack(() => filterKey),
    limit: restored?.limit ?? pageSize,
  });
  let shown = $derived(shownCount(paging, filterKey, items.length));
  let grid = $state<HTMLElement>();
  let sentinel = $state<HTMLElement>();
  const observing = canObserve();

  function more() {
    paging = nextPage(paging, filterKey, items.length);
  }

  async function showMore(event: MouseEvent) {
    event.preventDefault();
    const firstNew = shown;
    more();
    await tick();
    grid?.children[firstNew]?.querySelector<HTMLElement>('a[href]')?.focus();
  }

  async function revealMore(reveal: () => void) {
    const firstNew = shown;
    reveal();
    await tick();
    more();
    await tick();
    grid?.children[firstNew]?.querySelector<HTMLElement>('a[href]')?.focus();
  }

  // Render the next page two screens before the end of the list; re-armed after every page.
  $effect(() => {
    if (!observing || !sentinel || shown >= items.length) return;
    return whenNearView(sentinel, more, '200% 0px');
  });

  function save(focus: string | undefined) {
    if (!grid) return;
    history.replaceState(
      withPosition(history.state, name, {
        limit: shown,
        scrollY: window.scrollY,
        top: documentTop(grid),
        focus,
      }),
      '',
    );
  }
  function focusedLink(): string | undefined {
    const active = document.activeElement;
    return active instanceof HTMLAnchorElement && grid?.contains(active) ? (active.getAttribute('href') ?? undefined) : undefined;
  }

  $effect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Pending saves are dropped on unmount: by then the history entry is already the next page's.
    const onScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(() => save(focusedLink()), 150);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener('scroll', onScroll);
    };
  });

  $effect(() => {
    if (!restored) return;
    untrack(() => {
      if (!grid) return;
      window.scrollTo(0, restoredScrollY(restored, documentTop(grid)));
      if (restored.focus) grid.querySelector<HTMLElement>(`a[href="${CSS.escape(restored.focus)}"]`)?.focus({ preventScroll: true });
    });
  });
</script>

<div
  class="paged-grid"
  bind:this={grid}
  onfocusin={() => save(focusedLink())}>
  {#each items.slice(0, shown) as item (itemKey(item))}
    <div
      class="paged-grid__item"
      {@attach packInRows}>
      {@render card(item)}
    </div>
  {/each}
</div>
{#if shown < items.length}
  <div
    class="paged-grid__more"
    bind:this={sentinel}>
    {#if !observing}
      <button
        class="button"
        onclick={showMore}>
        {$t('common.showMore')}
      </button>
    {/if}
  </div>
{:else}
  {@render end?.(revealMore)}
{/if}

<style>
  /* Cards differ a lot in height (compact glaze rows, tall combination cards). Rows are small and
     fixed, and each item spans its measured height (packInRows), so items fill the free space in
     DOM order instead of leaving gaps below short neighbours. */
  .paged-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    grid-auto-rows: 0.25rem;
    column-gap: var(--space-5);
  }
  .paged-grid__item {
    align-self: start;
    padding-bottom: var(--space-5);
  }
  .paged-grid__more {
    display: flex;
    justify-content: center;
    min-height: 1px;
    margin-top: var(--space-5);
  }
  @media (width < 68.75em) {
    .paged-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (width < 45em) {
    /* minmax(0, …) as above: a plain 1fr grows to the widest item's longest word, which pushed the page past a 320 px screen
       (a glaze row in German or Spanish, LANG-6). */
    .paged-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
