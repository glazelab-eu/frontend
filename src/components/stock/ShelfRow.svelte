<script lang="ts">
  import { coverPosition } from '../../lib/images/photo-focus';
  import { t, formatNumber } from '../../lib/i18n';
  import type { StockWrite } from '../../lib/api/inputs';
  import type { StockItem } from '../../lib/api/models';
  import { pictureSrc, type Picture } from '../../lib/images/pictures';
  import { isUsedUp } from '../../lib/stock/shelf';
  import ImageView from '../images/ImageView.svelte';
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
  class={['shelf-row', { 'shelf-row--used-up': isUsedUp(item) }]}
  data-stock-id={item.id}>
  <div class="shelf-row__main">
    {#if picture}
      <ImageView
        variant="thumbnail"
        src={pictureSrc(picture.image)}
        position={coverPosition(picture.image)}
        {userId}
        alt={$t('images.alt.tile', { values: { title } })} />
    {:else}
      <div
        class="shelf-row__icon"
        aria-hidden="true">
        ◒
      </div>
    {/if}
    <div class="shelf-row__text">
      <a
        class="shelf-row__title"
        {href}>
        {title}
      </a>
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
    </div>
  </div>
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
  .shelf-row__main {
    flex: 1 1 11rem;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-2-5);
  }
  .shelf-row__icon {
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
  .shelf-row__text {
    min-width: 0;
  }
  .shelf-row__title {
    display: block;
    font-size: var(--font-sm);
    font-weight: 700;
    color: var(--ink);
    overflow-wrap: anywhere;
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
  .shelf-row--used-up .shelf-row__title {
    color: var(--muted);
  }
  @media (pointer: coarse) {
    .shelf-row__title {
      display: flex;
      align-items: center;
      min-height: var(--touch-target);
    }
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
