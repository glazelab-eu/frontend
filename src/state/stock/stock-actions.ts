import type { MessageKey } from '../../lib/i18n';
import { api } from '../../lib/api/client';
import type { StockWrite } from '../../lib/api/inputs';
import type { StockItem } from '../../lib/api/models';
import { isAddition, withSavedStock, withStockEntry } from '../../lib/stock/shelf';
import { newRequestId } from '../../lib/api/request-id';
import type { AppContext } from '../app/context';

/** Shelf writes: amounts, removal and "Keep private", patched into the listing in place where they can be. */
export function createStockActions(ctx: Pick<AppContext, 'read' | 'patch' | 'mutate' | 'load' | 'saveCurrent'>) {
  /**
   * The last addition that failed, with its request ID: the same addition sent again (the person taps once more after
   * the error, which may have been a lost answer) repeats the ID, so the server adds it once; it remembers only committed
   * additions, so a repeat of one that never arrived adds as usual. Any other addition, and every one while nothing
   * failed (a second tap while the first is still out counts twice, on purpose), gets a new ID.
   */
  let failed: { key: string; requestId: string } | undefined;

  /**
   * Writes a glaze's entry on a shelf. A `StockInput` sets the amount ("Used up" is 0 g, a typed amount; last write
   * wins); a `StockAddInput` ("+1 jar", the form's jar mode, one-click adds, the scan sheet's + steps) adds grams to
   * what the server holds, and the listing takes the server's total, so a stale device or a second club member never
   * loses a jar. A save's `jarSizeG` sets the jar size; an addition's is stored only where the entry has none, unless
   * `replaceJarSize`; left out, the entry keeps its own. A listed entry is patched in place
   * (the shelf list keeps its rows and focus); an entry not listed yet reloads for its names. A failure of the shelf
   * form shows at the form; `inList` (a row's own buttons) uses the banner.
   */
  function saveStock(write: StockWrite, inList = false, notice: MessageKey = 'notices.stockUpdated') {
    return ctx.mutate({
      // Answers how the listing changes, or null when it does not hold the entry.
      request: async (): Promise<(stock: StockItem[]) => StockItem[] | null> => {
        if (isAddition(write)) {
          const key = JSON.stringify([ctx.read().user?.id ?? null, write]);
          const requestId = failed?.key === key ? failed.requestId : newRequestId();
          let entry: StockItem;
          try {
            entry = await api.addStock({ ...write, requestId });
          } catch (error) {
            failed = { key, requestId };
            throw error;
          }
          if (failed?.requestId === requestId) failed = undefined;
          return (stock) => withStockEntry(stock, entry);
        }
        const { id } = await api.saveStock(write);
        return (stock) => withSavedStock(stock, id, write);
      },
      apply: async (updated, actor) => {
        const stock = updated(ctx.read().stock);
        if (!stock) return void (await ctx.load());
        ctx.patch({ stock });
        await ctx.saveCurrent(actor);
      },
      notice,
      form: inList ? undefined : 'stock',
    });
  }

  /** Removes a stock entry; the listing drops it without a reload. A 404 (gone meanwhile) reloads. */
  function removeStock(id: string) {
    return ctx.mutate({
      request: () => api.removeStock(id),
      apply: async (_, actor) => {
        ctx.patch({ stock: ctx.read().stock.filter((item) => item.id !== id) });
        await ctx.saveCurrent(actor);
      },
      notice: 'notices.stockRemoved',
      requireOnline: true,
      // 403: a club entry this account may no longer remove (demoted, or its adder rejoined); the reload hides Remove.
      reloadOn: [403, 404],
    });
  }

  /**
   * "Keep private" on a personal shelf entry: buddies never see the glaze while it is on. The listing is patched in place (the
   * row keeps its place and focus); a 404 (the entry went meanwhile) reloads.
   */
  function setKeepPrivate(id: string, keepPrivate: boolean) {
    return ctx.mutate({
      request: () => api.setKeepPrivate(id, keepPrivate),
      apply: async (_, actor) => {
        ctx.patch({ stock: ctx.read().stock.map((item) => (item.id === id ? { ...item, keepPrivate } : item)) });
        await ctx.saveCurrent(actor);
      },
      notice: keepPrivate ? 'notices.keepPrivateOn' : 'notices.keepPrivateOff',
      requireOnline: true,
      reloadOn: [404],
    });
  }

  return { saveStock, removeStock, setKeepPrivate };
}
