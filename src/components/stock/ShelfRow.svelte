<script lang="ts">
  import { t, formatNumber } from '../../lib/i18n';
  import type { StockWrite } from '../../lib/api/inputs';
  import type { StockItem } from '../../lib/api/models';
  import type { Picture } from '../../lib/images/pictures';
  import { isUsedUp } from '../../lib/stock/shelf';
  import ShelfGlaze from './ShelfGlaze.svelte';
  import ShelfControls from './ShelfControls.svelte';

  interface Props {
    item: StockItem;
    /** The glaze's display code and name. */
    title: string;
    /** Link to the glaze page. */
    href: string;
    picture: Picture | null;
    /** Who put a club entry on the shelf, while they are a member (`stockAdder`); null for none or personal stock. */
    adder?: { you: true } | { name: string } | null;
    userId: string;
    /** Offline the row is read-only: the amount is text and there are no buttons. */
    online: boolean;
    onSave: (input: StockWrite) => Promise<boolean>;
    onRemove: (id: string) => Promise<boolean>;
    /** Switches "Keep private" (hidden from buddies) of a personal entry; omitted, the row offers no switch. A club entry never does. */
    onKeepPrivate?: (id: string, keepPrivate: boolean) => Promise<boolean>;
  }

  let { item, title, href, picture, adder = null, userId, online, onSave, onRemove, onKeepPrivate }: Props = $props();
  let privateBusy = $state(false);

  async function keepPrivate(event: Event) {
    const box = event.currentTarget as HTMLInputElement;
    const wanted = box.checked;
    if (privateBusy || !onKeepPrivate) return;
    privateBusy = true;
    try {
      // A refused or failed write leaves the entry as it was: the box goes back to what the listing says.
      if (!(await onKeepPrivate(item.id, wanted))) box.checked = item.keepPrivate;
    } finally {
      privateBusy = false;
    }
  }
</script>

<li
  class="shelf-row"
  data-stock-id={item.id}>
  <ShelfGlaze
    {title}
    {href}
    {picture}
    {userId}
    muted={isUsedUp(item)}>
    {#if item.jarSizeG}
      <small class="shelf-row__jar">
        {$t('stock.row.jar', { values: { quantity: $formatNumber(item.jarSizeG) } })}
      </small>
    {/if}
    {#if adder}
      <small class="shelf-row__added">
        {'you' in adder ? $t('stock.row.addedByYou') : $t('stock.row.addedBy', { values: { name: adder.name } })}
      </small>
    {/if}
  </ShelfGlaze>
  <ShelfControls
    {item}
    {title}
    {online}
    {onSave}
    {onRemove} />
  {#if onKeepPrivate && !item.clubId}
    <div class="shelf-row__privacy">
      <label class="shelf-row__private">
        <input
          type="checkbox"
          checked={item.keepPrivate}
          disabled={!online || privateBusy}
          aria-label={$t('stock.row.keepPrivateFor', { values: { glaze: title } })}
          aria-describedby={`shelf-privacy-${userId}`}
          onchange={keepPrivate} />
        {$t('stock.row.keepPrivate')}
      </label>
    </div>
  {/if}
</li>

<style>
  .shelf-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    border-top: 0.0625rem solid var(--border);
    padding: var(--space-3) 0;
  }
  .shelf-row__jar,
  .shelf-row__added {
    display: block;
    margin-top: var(--space-0-5);
    color: var(--muted);
    font-size: var(--font-xs);
  }
  .shelf-row__added {
    overflow-wrap: anywhere;
  }
  .shelf-row__privacy {
    flex: 1 1 100%;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0 var(--space-3);
  }
  .shelf-row__private {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--font-sm);
  }
  @media (pointer: coarse) {
    .shelf-row__jar,
    .shelf-row__added {
      font-size: var(--font-body);
    }
    .shelf-row__private {
      min-height: var(--touch-target);
      font-size: var(--font-body);
    }
  }
</style>
