import type { Locator, Page } from '@playwright/test';
import { t, withCount, type MessageKey } from '../i18n';

/** Explore: search, the Show and View chips, sort and the paged list. */
export class ExplorePage {
  readonly search: Locator;
  readonly sort: Locator;
  /** Combination cards of the list. */
  readonly cards: Locator;
  readonly cardTitles: Locator;

  constructor(readonly page: Page) {
    const main = page.getByRole('main');
    this.search = main.getByRole('textbox', { name: t('discover.search.label') });
    this.sort = main.getByRole('combobox', { name: t('discover.sort.label') });
    this.cards = main.getByRole('article');
    this.cardTitles = this.cards.getByRole('heading');
  }

  /** A Show or View chip; its name ends with its count. */
  chip(label: Extract<MessageKey, `discover.type.${string}` | `discover.quick.${string}`>): Locator {
    return this.page.getByRole('main').getByRole('link', { name: withCount(t(label)) });
  }

  /** A choice of the shelf's stock row under "On my shelf" (in stock, used up, all); its name ends with its count. */
  shelfChoice(label: Extract<MessageKey, `discover.shelfStock.${'stock' | 'used' | 'all'}`>): Locator {
    return this.page
      .getByRole('main')
      .getByRole('group', { name: t('discover.shelfStock.label') })
      .getByRole('link', { name: withCount(t(label)) });
  }

  card(title: string): Locator {
    return this.cards.filter({ has: this.page.getByRole('heading', { name: title, exact: true }) });
  }
}
