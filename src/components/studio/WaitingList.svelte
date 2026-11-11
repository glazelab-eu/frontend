<script lang="ts">
  import { flushSync, onDestroy } from 'svelte';
  import { t } from '../../lib/i18n';
  import type { UploadTarget } from '../../lib/api/models';
  import { home, routeHref } from '../../lib/routing/routes';
  import { focusAfterRow } from '../../lib/studio/waiting';
  import FoldPanel from './FoldPanel.svelte';

  interface Props {
    /** The newest shared glazes and own published combinations without a result photo; none hides the list. */
    items: UploadTarget[];
    /** How many are waiting in all, listed or not. */
    total: number;
    onAddPhoto: (target: UploadTarget, returnFocus: () => boolean) => void;
    /** The last row left (its photo was added) and the dialog closed: the page picks the place for focus. */
    onEmptied: () => void;
    /** Below 720 px the list is folded behind its heading with the total. */
    phone: boolean;
  }

  let { items, total, onAddPhoto, onEmptied, phone }: Props = $props();
  let list = $state<HTMLElement>();
  let fold = $state<ReturnType<typeof FoldPanel>>();
  let mounted = true;
  onDestroy(() => (mounted = false));

  /**
   * The row's button is gone once its photo is in and the dialog closes after that, so the dialog's own focus return
   * finds no opener and asks this instead (when the row is still there it focuses the button itself).
   */
  function returnFocus(index: number) {
    if (!mounted) return false;
    flushSync();
    const buttons = list?.querySelectorAll<HTMLElement>('.waiting-list__add');
    const next = focusAfterRow(index, buttons?.length ?? 0, items.length);
    if (next.to === 'row') buttons![next.index].focus();
    // The window narrowed while the dialog was open: rows remain, but folded away behind the heading.
    else if (next.to === 'fold') fold?.focus();
    else onEmptied();
    return true;
  }
</script>

{#if items.length}
  <FoldPanel
    class="waiting-list"
    bind:this={fold}
    id="waiting-list-body"
    title={$t('discover.quick.waiting')}
    count={total}
    {phone}>
    <ul
      class="waiting-list__items"
      bind:this={list}
      aria-label={$t('discover.quick.waiting')}>
      {#each items as item, index (`${item.type}:${item.id}`)}
        <li class="waiting-list__item">
          <a
            class="waiting-list__link"
            href={routeHref({ name: item.type === 'glaze' ? 'glaze' : 'combination', id: item.id })}>
            {item.title}
          </a>
          <button
            type="button"
            class="button waiting-list__add"
            aria-label={$t('studio.waiting.add', { values: { title: item.title } })}
            onclick={() => onAddPhoto(item, () => returnFocus(index))}>
            {$t('images.addTestTile')}
          </button>
        </li>
      {/each}
    </ul>
    <p class="waiting-list__foot">
      {#if total > items.length}
        <span class="waiting-list__more">
          {$t('studio.waiting.more', { values: { count: total - items.length } })}
        </span>
      {/if}
      <a
        class="waiting-list__all"
        href={routeHref({ ...home, quick: 'waiting' })}>
        {$t('studio.waiting.seeAll')}
      </a>
    </p>
  </FoldPanel>
{/if}

<style>
  .waiting-list__items {
    display: grid;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .waiting-list__item {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2) var(--space-3);
    min-height: var(--touch-target);
    border-top: 0.0625rem solid var(--border);
    padding: var(--space-1) 0;
  }
  .waiting-list__link {
    flex: 1 1 10rem;
    min-width: 0;
    color: var(--accent);
    font-weight: 700;
    overflow-wrap: anywhere;
  }
  .waiting-list__add {
    min-height: var(--touch-target);
  }
  .waiting-list__foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-3);
    margin: var(--space-3) 0 0;
    font-size: var(--font-xs);
  }
  .waiting-list__more {
    color: var(--muted);
  }
  .waiting-list__all {
    display: inline-block;
    padding: var(--space-2) 0;
    color: var(--accent);
    font-weight: 600;
  }
  @media (pointer: coarse) {
    .waiting-list__link,
    .waiting-list__all {
      display: inline-flex;
      align-items: center;
      min-height: var(--touch-target);
      padding-block: 0;
    }
    .waiting-list__foot {
      font-size: var(--font-body);
    }
  }
</style>
