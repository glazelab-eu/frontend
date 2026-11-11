import type { Page } from '@playwright/test';
import type { Api } from '../support/api';
import { eanFor } from '../support/barcodes';
import { stockItem } from '../../src/test/fixtures';
import { SHELF_FIRST_ROWS } from '../../src/lib/stock/shelf';
import { t, withCount } from '../support/i18n';
import { mockApi } from '../support/mock-api';
import { expect, test } from '../support/test';

/** Two glazes on the personal shelf (one used up), two on the club Kiln's, none on the club Atelier's. */
async function seed(api: Api, uid: string) {
  const fern = await api.addGlaze({ newManufacturer: { name: `Shelf ${uid}`, shortId: uid.toUpperCase() }, code: 'F-1', name: 'Fern', barcode: eanFor(uid) });
  const manufacturerId = fern.glaze.manufacturer.id;
  const glaze = async (code: string, name: string) => (await api.addGlaze({ manufacturerId, code, name })).id;
  const [moss, ash, birch] = [await glaze('M-1', 'Moss'), await glaze('A-1', 'Ash'), await glaze('B-1', 'Birch')];
  // Creating a club answers its ID only: the names are the ones asked for.
  const kiln = { id: (await api.clubWithInvite(`Kiln ${uid}`)).club.id, name: `Kiln ${uid}` };
  const atelier = { id: (await api.clubWithInvite(`Atelier ${uid}`)).club.id, name: `Atelier ${uid}` };
  await api.addStock({ glazeId: fern.id, ownerType: 'personal', quantityG: 400 });
  await api.addStock({ glazeId: moss, ownerType: 'personal', quantityG: 0 });
  await api.addStock({ glazeId: ash, ownerType: 'club', clubId: kiln.id, quantityG: 300 });
  await api.addStock({ glazeId: birch, ownerType: 'club', clubId: kiln.id, quantityG: 200 });
  return { fern: fern.id, kiln, atelier };
}

const main = (page: Page) => page.getByRole('main');
const chips = (page: Page) => main(page).getByRole('group', { name: t('stock.shelves.label') });
const personalGroup = (page: Page) => main(page).getByRole('heading', { level: 3, name: t('stock.group.personal'), exact: true });
const clubGroup = (page: Page, name: string) => main(page).getByRole('heading', { level: 3, name: t('stock.group.club', { club: name }), exact: true });

test('the chips split the shelf by owner, sorted by name, one history entry each', async ({ page, shell, api, signedIn, uid }) => {
  const { kiln, atelier } = await seed(api, uid);
  await shell.open('#/stock');
  await shell.expectSignedIn(signedIn.displayName);
  await expect(personalGroup(page)).toBeVisible();
  await expect(clubGroup(page, kiln.name)).toBeVisible();
  // All shelves, Personal, then the clubs by name; the counts are the entries in stock.
  await expect(chips(page).getByRole('link')).toHaveText([/^All shelves 3$/, /^Personal 1$/, withCount(atelier.name), withCount(kiln.name)]);
  await expect(chips(page).getByRole('link', { name: withCount(t('stock.shelves.all')) })).toHaveAttribute('aria-current', 'page');
  await expect(main(page).getByRole('heading', { level: 1 })).toHaveCount(1);

  await chips(page)
    .getByRole('link', { name: withCount(kiln.name) })
    .click();
  await expect(page).toHaveURL(new RegExp(`#/stock\\?shelf=${kiln.id}$`));
  await expect(clubGroup(page, kiln.name)).toBeVisible();
  await expect(personalGroup(page)).toBeHidden();
  await expect(main(page).getByText('Ash', { exact: false }).first()).toBeVisible();
  await expect(main(page).getByText('Fern')).toBeHidden();
  await expect(chips(page).getByRole('link', { name: withCount(kiln.name) })).toHaveAttribute('aria-current', 'page');

  await chips(page)
    .getByRole('link', { name: withCount(t('stock.owner.me')) })
    .click();
  await expect(page).toHaveURL(/#\/stock\?shelf=personal$/);
  await expect(personalGroup(page)).toBeVisible();
  await expect(clubGroup(page, kiln.name)).toBeHidden();
  // The used up glaze of the shelf stays in its own group.
  await expect(main(page).getByText(t('stock.group.usedUp', { count: 1 }))).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`#/stock\\?shelf=${kiln.id}$`));
  await expect(clubGroup(page, kiln.name)).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/#\/stock$/);
  await expect(personalGroup(page)).toBeVisible();
  await expect(clubGroup(page, kiln.name)).toBeVisible();
});

test('an empty club shelf says so', async ({ page, shell, api, signedIn, uid }) => {
  const { atelier } = await seed(api, uid);
  await shell.open(`#/stock?shelf=${atelier.id}`);
  await shell.expectSignedIn(signedIn.displayName);
  await expect(main(page).getByText(t('stock.shelves.emptyClub', { club: atelier.name }))).toBeVisible();
  await expect(chips(page).getByRole('link', { name: withCount(atelier.name) })).toHaveAttribute('aria-current', 'page');
  // The form below still adds to it.
  await expect(main(page).getByRole('combobox', { name: t('stock.form.owner'), exact: true })).toHaveValue(atelier.id);
});

test('a chip change keeps the add-form draft and a deep link starts the form on its owner', async ({ page, shell, api, signedIn, uid }) => {
  const { kiln } = await seed(api, uid);
  await shell.open(`#/stock?shelf=${kiln.id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const owner = main(page).getByRole('combobox', { name: t('stock.form.owner'), exact: true });
  await expect(owner).toHaveValue(kiln.id);

  // No glaze chosen yet: the form follows the chips.
  await chips(page)
    .getByRole('link', { name: withCount(t('stock.owner.me')) })
    .click();
  await expect(owner).toHaveValue('personal');

  const picker = main(page).getByRole('combobox', { name: t('common.glaze') });
  await picker.fill('Birch');
  await page.getByRole('option', { name: /Birch/ }).first().click();
  await owner.selectOption(kiln.id);
  const amount = main(page).getByLabel(t('stock.form.quantity'));
  await amount.fill('123');

  await chips(page)
    .getByRole('link', { name: withCount(kiln.name) })
    .click();
  await expect(page).toHaveURL(new RegExp(`#/stock\\?shelf=${kiln.id}$`));
  await chips(page)
    .getByRole('link', { name: withCount(t('stock.shelves.all')) })
    .click();
  await expect(page).toHaveURL(/#\/stock$/);
  await chips(page)
    .getByRole('link', { name: withCount(t('stock.owner.me')) })
    .click();
  await expect(picker).toHaveValue(/Birch/);
  await expect(amount).toHaveValue('123');
  await expect(owner).toHaveValue(kiln.id);
});

test('?glaze= and a shelf work together', async ({ page, shell, api, signedIn, uid }) => {
  const { fern, kiln } = await seed(api, uid);
  await shell.open(`#/stock?glaze=${fern}&shelf=${kiln.id}`);
  await shell.expectSignedIn(signedIn.displayName);
  await expect(main(page).getByRole('combobox', { name: t('common.glaze') })).toHaveValue(/Fern/);
  await expect(clubGroup(page, kiln.name)).toBeVisible();
  await expect(personalGroup(page)).toBeHidden();
  // The glaze link stays in the address when a chip changes.
  await chips(page)
    .getByRole('link', { name: withCount(t('stock.shelves.all')) })
    .click();
  await expect(page).toHaveURL(new RegExp(`#/stock\\?glaze=${fern}$`));
  await expect(main(page).getByRole('combobox', { name: t('common.glaze') })).toHaveValue(/Fern/);
});

test('an unknown club shows all shelves', async ({ page, shell, api, signedIn, uid }) => {
  const { kiln } = await seed(api, uid);
  await shell.open('#/stock?shelf=00000000-0000-4000-8000-000000000009');
  await shell.expectSignedIn(signedIn.displayName);
  await expect(personalGroup(page)).toBeVisible();
  await expect(clubGroup(page, kiln.name)).toBeVisible();
  await expect(chips(page).getByRole('link', { name: withCount(t('stock.shelves.all')) })).toHaveAttribute('aria-current', 'page');
  await expect(main(page).getByRole('combobox', { name: t('stock.form.owner'), exact: true })).toHaveValue('personal');
});

test('an account without a club has no chips, and ignores the shelf in the link', async ({ page, shell, api, signedIn, uid }) => {
  const fern = await api.addGlaze({ newManufacturer: { name: `Shelf ${uid}`, shortId: uid.toUpperCase() }, code: 'F-1', name: 'Fern' });
  await api.addStock({ glazeId: fern.id, ownerType: 'personal', quantityG: 400 });
  await shell.open('#/stock?shelf=personal');
  await shell.expectSignedIn(signedIn.displayName);
  await expect(personalGroup(page)).toBeVisible();
  await expect(chips(page)).toHaveCount(0);
});

test('the club page links to its shelf, and the shelf links back', async ({ page, shell, api, signedIn, uid }) => {
  const { kiln } = await seed(api, uid);
  await shell.open(`#/clubs/${kiln.id}`);
  await shell.expectSignedIn(signedIn.displayName);
  await main(page)
    .getByRole('link', { name: t('clubs.page.shelfLink', { count: 2 }) })
    .click();
  await expect(page).toHaveURL(new RegExp(`#/stock\\?shelf=${kiln.id}$`));
  await expect(clubGroup(page, kiln.name)).toBeVisible();
  const back = main(page).getByRole('link', { name: kiln.name, exact: true });
  await expect(back).toBeVisible();
  await back.click();
  await expect(page).toHaveURL(new RegExp(`#/clubs/${kiln.id}$`));
  await expect(main(page).getByRole('heading', { level: 1, name: kiln.name })).toBeVisible();
});

test('the shelf opened directly has no back link', async ({ page, shell, api, signedIn, uid }) => {
  await seed(api, uid);
  await shell.open('#/stock');
  await shell.expectSignedIn(signedIn.displayName);
  await expect(personalGroup(page)).toBeVisible();
  await expect(main(page).locator('.back-link')).toHaveCount(0);
});

test('a scanned barcode link keeps its glaze in the form when a chip changes', async ({ page, shell, api, signedIn, uid }) => {
  const { kiln } = await seed(api, uid);
  await shell.open(`#/stock/${eanFor(uid)}?shelf=${kiln.id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const picker = main(page).getByRole('combobox', { name: t('common.glaze') });
  await expect(picker).toHaveValue(/Fern/);
  await expect(clubGroup(page, kiln.name)).toBeVisible();
  await chips(page)
    .getByRole('link', { name: withCount(t('stock.owner.me')) })
    .click();
  await expect(page).toHaveURL(new RegExp(`#/stock/${eanFor(uid)}\\?shelf=personal$`));
  await expect(personalGroup(page)).toBeVisible();
  await expect(picker).toHaveValue(/Fern/);
});

/** A glaze of its own manufacturer, for tests that need no seeded shelf. */
async function fernOf(api: Api, uid: string) {
  return api.addGlaze({ newManufacturer: { name: `Shelf ${uid}`, shortId: uid.toUpperCase() }, code: 'F-1', name: 'Fern' });
}

test('an empty personal shelf says so, not that the whole shelf is empty', async ({ page, shell, api, signedIn, uid }) => {
  const fern = await fernOf(api, uid);
  const kiln = (await api.createClub(`Kiln ${uid}`)).id;
  await api.addStock({ glazeId: fern.id, ownerType: 'club', clubId: kiln, quantityG: 300 });
  await shell.open('#/stock?shelf=personal');
  await shell.expectSignedIn(signedIn.displayName);
  await expect(chips(page).getByRole('link', { name: withCount(t('stock.owner.me')) })).toHaveAttribute('aria-current', 'page');
  await expect(main(page).getByText(t('stock.shelves.emptyPersonal'))).toBeVisible();
  await expect(main(page).getByText(t('stock.empty'))).toHaveCount(0);
});

test('a club shelf of used up glazes lists them instead of saying it is empty', async ({ page, shell, api, signedIn, uid }) => {
  const fern = await fernOf(api, uid);
  const name = `Kiln ${uid}`;
  const kiln = (await api.createClub(name)).id;
  await api.addStock({ glazeId: fern.id, ownerType: 'club', clubId: kiln, quantityG: 0 });
  await shell.open(`#/stock?shelf=${kiln}`);
  await shell.expectSignedIn(signedIn.displayName);
  // The chip counts glazes in stock only.
  await expect(chips(page).getByRole('link', { name: withCount(name) })).toHaveText(new RegExp(`^${name} 0$`));
  await expect(main(page).getByText(t('stock.group.usedUp', { count: 1 }))).toBeVisible();
  await expect(main(page).getByText(t('stock.shelves.emptyClub', { club: name }))).toHaveCount(0);
});

test('the text filter survives chip changes, and a filter matching nothing on a club shelf says so', async ({ page, shell, api, signedIn, uid }) => {
  const fern = await fernOf(api, uid);
  const manufacturerId = fern.glaze.manufacturer.id;
  const name = `Kiln ${uid}`;
  const kiln = (await api.createClub(name)).id;
  // 4 personal and 10 club entries: the club shelf alone reaches SHELF_FILTER_FROM.
  for (let i = 0; i < 14; i++) {
    const glazeId = (await api.addGlaze({ manufacturerId, code: `G-${i}`, name: `Glaze${i}` })).id;
    await api.addStock(i < 4 ? { glazeId, ownerType: 'personal', quantityG: 100 } : { glazeId, ownerType: 'club', clubId: kiln, quantityG: 100 });
  }
  await shell.open('#/stock');
  await shell.expectSignedIn(signedIn.displayName);
  const filter = main(page).getByRole('searchbox', { name: t('stock.list.filter') });
  await filter.fill('Glaze2');
  await chips(page)
    .getByRole('link', { name: withCount(name) })
    .click();
  await expect(page).toHaveURL(new RegExp(`#/stock\\?shelf=${kiln}$`));
  await expect(filter).toHaveValue('Glaze2');
  await expect(main(page).getByText(t('stock.list.noMatch'))).toBeVisible();
  await expect(main(page).getByText(t('stock.shelves.emptyClub', { club: name }))).toHaveCount(0);
  await filter.fill('Glaze1');
  await expect(main(page).getByRole('link', { name: `Shelf ${uid} G-12 Glaze12` })).toBeVisible();
  await expect(main(page).getByRole('link', { name: `Shelf ${uid} G-1 Glaze1`, exact: true })).toHaveCount(0);
});

test('many clubs with long names: the active chip is in view and the page never scrolls sideways', async ({ page, shell, api, signedIn, uid }) => {
  const fern = await fernOf(api, uid);
  const clubs: { id: string; name: string }[] = [];
  for (let i = 0; i < 8; i++) {
    const name = `${i === 7 ? 'Zz' : 'Club'} ${i} Töpferwerkstatt am Rande der Stadt ${uid}`;
    clubs.push({ id: (await api.createClub(name)).id, name });
  }
  const last = clubs[7];
  await api.addStock({ glazeId: fern.id, ownerType: 'club', clubId: last.id, quantityG: 100 });
  await shell.open(`#/stock?shelf=${last.id}`);
  await shell.expectSignedIn(signedIn.displayName);
  await expect(clubGroup(page, last.name)).toBeVisible();
  const active = chips(page).getByRole('link', { name: withCount(last.name) });
  await expect(active).toHaveAttribute('aria-current', 'page');
  await expect(active).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  // A shelf reached without a click (Back, a link elsewhere) shows its chip too: the page is not mounted again.
  await page.evaluate(() => (location.hash = '#/stock'));
  await expect(chips(page).getByRole('link', { name: withCount(t('stock.shelves.all')) })).toBeInViewport();
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`shelf=${last.id}$`));
  await expect(active).toBeInViewport();
});

/**
 * Whether the active chip stands clear of the row's fades, in `frames` painted frames from the one where a chip holding `active` is
 * current (a task posted from the animation frame runs after its paint). A fade covers nothing at the row's own ends.
 */
const chipClearInFrames = (row: Element, { active, frames }: { active: string; frames: number }) =>
  new Promise<boolean[]>((resolve) => {
    const seen: boolean[] = [];
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      const current = row.querySelector('[aria-current]');
      if (current?.textContent?.includes(active)) {
        const chip = current.getBoundingClientRect();
        const box = row.getBoundingClientRect();
        const fade = parseFloat(getComputedStyle(row).scrollPaddingInlineStart);
        const atEnd = row.scrollLeft + row.clientWidth >= row.scrollWidth - 1;
        seen.push(chip.left >= box.left + (row.scrollLeft > 0 ? fade : 0) - 1 && chip.right <= box.right - (atEnd ? 0 : fade) + 1);
      }
      if (seen.length >= frames) {
        channel.port1.close();
        resolve(seen);
      } else requestAnimationFrame(() => channel.port2.postMessage(0));
    };
    requestAnimationFrame(() => channel.port2.postMessage(0));
  });

test('phone: the active chip is clear of the fades from the first frame, restored, moved through history or after a language change', async ({
  page,
  shell,
  api,
  signedIn,
  uid,
  isMobile,
}) => {
  test.skip(!isMobile, 'the chips scroll on phones only');
  const fern = await fernOf(api, uid);
  const clubs: { id: string; name: string }[] = [];
  for (let i = 0; i < 8; i++) {
    const name = `Club ${i} ${uid}`;
    clubs.push({ id: (await api.createClub(name)).id, name });
  }
  await api.addStock({ glazeId: fern.id, ownerType: 'club', clubId: clubs[7].id, quantityG: 100 });
  await api.addStock({ glazeId: fern.id, ownerType: 'club', clubId: clubs[3].id, quantityG: 100 });
  const scroller = chips(page).locator('.chip-row__chips');
  const clear = async () => (await scroller.evaluate(chipClearInFrames, { active: '', frames: 1 }))[0];

  // The default chip needs no scroll, and the row still knows it holds more.
  await shell.open('#/stock');
  await shell.expectSignedIn(signedIn.displayName);
  await expect(scroller).toHaveClass(/chip-row__chips--more-end/);
  await expect(scroller).not.toHaveClass(/chip-row__chips--more-start/);

  // Restored from the link: the first layout of the row reveals the chip, and both fades are right at once.
  await shell.open(`#/stock?shelf=${clubs[7].id}`);
  await expect(chips(page).getByRole('link', { name: withCount(clubs[7].name) })).toHaveAttribute('aria-current', 'page');
  await expect.poll(clear).toBe(true);
  await expect(scroller).toHaveClass(/chip-row__chips--more-start/);
  await expect(scroller).not.toHaveClass(/chip-row__chips--more-end/);

  // The same after a reload, where the row is laid out for the first time with that chip, and on the way back from the wide layout.
  await page.reload();
  await expect(chips(page).getByRole('link', { name: withCount(clubs[7].name) })).toHaveAttribute('aria-current', 'page');
  await expect.poll(clear).toBe(true);
  await scroller.evaluate((row) => (row.scrollLeft = 0));
  const phone = page.viewportSize()!;
  await page.setViewportSize({ width: 1000, height: phone.height });
  await expect.poll(() => scroller.evaluate((row) => row.clientWidth)).toBe(0);
  await page.setViewportSize(phone);
  await expect.poll(clear).toBe(true);

  // A chip that becomes active is revealed in the first frame that shows it.
  const frames = scroller.evaluate(chipClearInFrames, { active: 'Club 3', frames: 3 });
  await page.evaluate((href) => (location.hash = href), `#/stock?shelf=${clubs[3].id}`);
  expect(await frames).toEqual([true, true, true]);

  // Back through history, to the default chip at the start of the row, and back again.
  await page.goBack();
  await expect.poll(clear).toBe(true);
  await page.evaluate(() => (location.hash = '#/stock'));
  await expect(chips(page).getByRole('link', { name: withCount(t('stock.shelves.all')) })).toHaveAttribute('aria-current', 'page');
  await expect.poll(() => scroller.evaluate((row) => row.scrollLeft)).toBe(0);
  await expect(scroller).not.toHaveClass(/chip-row__chips--more-start/);
  await page.goBack();
  await expect.poll(clear).toBe(true);

  // The labels change width with the language; the chip stays in view.
  await page.getByRole('button', { name: t('header.accountMenu', { name: signedIn.displayName }) }).tap();
  await page.getByRole('combobox', { name: t('language.label') }).selectOption('de');
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await expect(main(page).locator('.chip-row__chips [aria-current]')).toBeInViewport();
});

/** Counts the chip rows' `offsetLeft` reads: all of them, and those outside an animation frame, where a read would force a layout of the page. */
const countChipReads = () => {
  const reads = { all: 0, outsideFrame: 0 };
  Object.assign(window, { chipReads: reads });
  let frames = 0;
  const schedule = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (run) =>
    schedule((time) => {
      frames++;
      try {
        run(time);
      } finally {
        frames--;
      }
    });
  const offsetLeft = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetLeft')!;
  Object.defineProperty(HTMLElement.prototype, 'offsetLeft', {
    get(this: HTMLElement) {
      if (this.closest('.chip-row__chips')) {
        reads.all++;
        if (!frames) reads.outsideFrame++;
      }
      return offsetLeft.get!.call(this);
    },
  });
};
const chipReads = (page: Page) => page.evaluate(() => (window as unknown as { chipReads: { all: number; outsideFrame: number } }).chipReads);

test('a chip change reads no geometry outside a frame, and wide screens read none at all', async ({ page, shell, api, signedIn, uid, isMobile }) => {
  await page.addInitScript(countChipReads);
  const { kiln, atelier } = await seed(api, uid);
  await api.addStock({ glazeId: (await fernOf(api, `${uid}x`)).id, ownerType: 'club', clubId: atelier.id, quantityG: 100 });
  await shell.open(`#/stock?shelf=${kiln.id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const current = chips(page).locator('[aria-current]');
  await expect(current).toContainText(kiln.name);
  await page.evaluate(() => Object.assign((window as unknown as { chipReads: object }).chipReads, { all: 0, outsideFrame: 0 }));
  await page.evaluate((href) => (location.hash = href), `#/stock?shelf=${atelier.id}`);
  await expect(current).toContainText(atelier.name);
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  const reads = await chipReads(page);
  expect(reads.outsideFrame).toBe(0);
  if (isMobile) expect(reads.all).toBeGreaterThan(0);
  else expect(reads.all).toBe(0);
});

test('phone: the fades follow a scroll and chips that change', async ({ page, shell, api, signedIn, uid, isMobile }) => {
  test.skip(!isMobile, 'the chips scroll on phones only');
  const fern = await fernOf(api, uid);
  await api.addStock({ glazeId: fern.id, ownerType: 'personal', quantityG: 100 });
  const club = await api.createClub('C');
  await api.addStock({ glazeId: fern.id, ownerType: 'club', clubId: club.id, quantityG: 100 });
  await shell.open('#/stock');
  await shell.expectSignedIn(signedIn.displayName);
  const scroller = chips(page).locator('.chip-row__chips');
  await expect(scroller).toHaveClass(/chip-row__chips--more-end/);
  await expect(scroller).not.toHaveClass(/chip-row__chips--more-start/);
  await scroller.evaluate((row) => (row.scrollLeft = 30));
  await expect(scroller).toHaveClass(/chip-row__chips--more-start/);
  await scroller.evaluate((row) => (row.scrollLeft = 0));
  await expect(scroller).not.toHaveClass(/chip-row__chips--more-start/);
  // The row keeps its width, so only the mutation tells: chips that come, go or change their words.
  await scroller.evaluate((row) => row.lastElementChild!.remove());
  await expect(scroller).not.toHaveClass(/chip-row__chips--more-end/);
});

test('a long shelf opens with its first rows, gets the others while idle, and a scroll to the form waits for no row', async ({
  page,
  shell,
  api,
  signedIn,
  uid,
}) => {
  const fern = await fernOf(api, uid);
  const manufacturerId = fern.glaze.manufacturer.id;
  await api.addStock({ glazeId: fern.id, ownerType: 'personal', quantityG: 100 });
  // More than SHELF_FIRST_ROWS, added in the reverse of their order; one used up.
  const ids: string[] = [];
  for (let i = 29; i > 0; i--) {
    const glazeId = (await api.addGlaze({ manufacturerId, code: `G-${i}`, name: `Glaze${i}` })).id;
    ids.push(glazeId);
    await api.addStock({ glazeId, ownerType: 'personal', quantityG: i === 29 ? 0 : 100 });
  }
  await api.addGlaze({ manufacturerId, code: 'S-1', name: 'Scanned', barcode: eanFor(uid) });
  await shell.open('#/stock');
  await shell.expectSignedIn(signedIn.displayName);
  const rows = main(page).locator('.shelf-group__list > [data-stock-id]');
  await expect(rows).toHaveCount(30);
  const titles = await rows.locator('.shelf-row__title').allTextContents();
  // Numbers in numeric order, the used up entry last.
  expect(titles.slice(0, 4).map((title) => title.trim())).toEqual([
    `Shelf ${uid} F-1 Fern`,
    `Shelf ${uid} G-1 Glaze1`,
    `Shelf ${uid} G-2 Glaze2`,
    `Shelf ${uid} G-3 Glaze3`,
  ]);
  expect(titles.at(-1)?.trim()).toBe(`Shelf ${uid} G-29 Glaze29`);
  await expect(main(page).getByText(t('stock.group.usedUp', { count: 1 }))).toBeVisible();

  // The filter and back: the rows come again.
  const filter = main(page).getByRole('searchbox', { name: t('stock.list.filter') });
  await filter.fill('Glaze28');
  await expect(rows).toHaveCount(1);
  await filter.fill('');
  await expect(rows).toHaveCount(30);

  // A link that chooses a glaze scrolls to the form: it stays in view, however many rows come above it.
  await page.evaluate(() => (location.hash = '#/'));
  await expect(rows).toHaveCount(0);
  const rowsAtFocus = (hash: string) =>
    page.evaluate(
      (target) =>
        new Promise<number>((resolve) => {
          const focused = (event: FocusEvent) => {
            if (!(event.target instanceof HTMLInputElement)) return;
            document.removeEventListener('focusin', focused);
            resolve(document.querySelectorAll('.shelf-group__list > [data-stock-id]').length);
          };
          document.addEventListener('focusin', focused);
          location.hash = target;
        }),
      hash,
    );
  expect(await rowsAtFocus(`#/stock?glaze=${ids[0]}`)).toBe(30);
  const quantity = main(page).getByRole('spinbutton', { name: t('stock.form.quantity') });
  await expect(quantity).toBeFocused();
  await expect(quantity).toBeInViewport();

  // So does the page's own button, pressed before the rows came.
  await page.evaluate(() => (location.hash = '#/'));
  await expect(rows).toHaveCount(0);
  const rowsAtPress = page.evaluate(
    (label) =>
      new Promise<number>((resolve) => {
        const press = () => {
          const button = [...document.querySelectorAll<HTMLButtonElement>('main button')].find((item) => item.textContent?.trim() === label);
          if (!button || !document.querySelector('[data-stock-id]')) return requestAnimationFrame(press);
          button.click();
          resolve(document.querySelectorAll('.shelf-group__list > [data-stock-id]').length);
        };
        location.hash = '#/stock';
        press();
      }),
    t('addGlaze.action'),
  );
  expect(await rowsAtPress).toBe(30);

  // And a scanned barcode's link.
  await page.evaluate(() => (location.hash = '#/'));
  await expect(rows).toHaveCount(0);
  expect(await rowsAtFocus(`#/stock/${eanFor(uid)}`)).toBe(30);
});

test('without idle callbacks, as in Safari, a long shelf still gets all its rows and a page left half way raises nothing', async ({
  page,
  shell,
  api,
  signedIn,
  uid,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => Reflect.deleteProperty(window, 'requestIdleCallback'));
  const fern = await fernOf(api, uid);
  const manufacturerId = fern.glaze.manufacturer.id;
  await api.addStock({ glazeId: fern.id, ownerType: 'personal', quantityG: 100 });
  for (let i = 1; i < 20; i++) {
    const glazeId = (await api.addGlaze({ manufacturerId, code: `G-${i}`, name: `Glaze${i}` })).id;
    await api.addStock({ glazeId, ownerType: 'personal', quantityG: 100 });
  }
  await shell.open('#/stock');
  await shell.expectSignedIn(signedIn.displayName);
  const rows = main(page).locator('[data-stock-id]');
  await expect(rows).toHaveCount(20);
  await page.evaluate(() => (location.hash = '#/'));
  await expect(rows).toHaveCount(0);
  await page.goBack();
  await page.evaluate(() => (location.hash = '#/'));
  await page.goBack();
  await expect(rows).toHaveCount(20);
  expect(errors).toEqual([]);
});

test('an entry that joins a whole list leaves the open used up rows open', async ({ page, shell, api, signedIn, uid }) => {
  const fern = await fernOf(api, uid);
  const manufacturerId = fern.glaze.manufacturer.id;
  await api.addStock({ glazeId: fern.id, ownerType: 'personal', quantityG: 100 });
  for (let i = 1; i < 16; i++) {
    const glazeId = (await api.addGlaze({ manufacturerId, code: `G-${i}`, name: `Glaze${i}` })).id;
    await api.addStock({ glazeId, ownerType: 'personal', quantityG: i > 13 ? 0 : 100 });
  }
  const newcomer = `Newcomer ${uid}`;
  await api.addGlaze({ manufacturerId, code: 'Z-1', name: newcomer });
  await shell.open('#/stock');
  await shell.expectSignedIn(signedIn.displayName);
  const rows = main(page).locator('[data-stock-id]');
  await expect(rows).toHaveCount(16);
  const usedUp = main(page).locator('details');
  await usedUp.locator('summary').click();

  const picker = main(page).getByRole('combobox', { name: t('common.glaze') });
  await picker.fill(newcomer);
  await page.getByRole('option', { name: new RegExp(newcomer) }).click();
  const quantity = main(page).getByRole('spinbutton', { name: t('stock.form.quantity') });
  await quantity.fill('300');
  await quantity.press('Enter');
  await expect(rows).toHaveCount(17);
  await expect(usedUp).toHaveJSProperty('open', true);
});

test('300 used up rows arrive in slices like the others, and their summary counts all of them from the first', async ({ page, shell }) => {
  const entry = (i: number, quantityG: number) => stockItem({ id: `s${i}`, glazeId: `g${i}`, name: `Glaze ${String(i).padStart(3, '0')}`, quantityG });
  const stock = [...Array.from({ length: 20 }, (_, i) => entry(i, 100)), ...Array.from({ length: 300 }, (_, i) => entry(100 + i, 0))];
  await mockApi(page, { answers: { 'GET /api/stock': { json: stock } } });
  // Rows added per batch of DOM updates (one idle slice; a row inserted with its list may count twice), and the used up summary as
  // it first appears.
  await page.addInitScript(() => {
    const seen = { batches: [] as number[], firstSummary: '' };
    Reflect.set(window, '__shelf', seen);
    new MutationObserver((records) => {
      let rows = 0;
      for (const record of records)
        for (const node of record.addedNodes)
          if (node instanceof Element) rows += Number(node.matches('[data-stock-id]')) + node.querySelectorAll('[data-stock-id]').length;
      if (rows) seen.batches.push(rows);
      if (!seen.firstSummary) seen.firstSummary = document.querySelector('details summary')?.textContent?.trim() ?? '';
    }).observe(document, { childList: true, subtree: true });
  });
  await shell.open('#/stock');
  const rows = main(page).locator('[data-stock-id]');
  await expect(rows).toHaveCount(320);
  await expect(main(page).getByText(t('stock.group.usedUp', { count: 300 }))).toBeVisible();
  const seen = await page.evaluate(() => Reflect.get(window, '__shelf') as { batches: number[]; firstSummary: string });
  expect(seen.firstSummary).toBe(t('stock.group.usedUp', { count: 300 }));
  // Each slice is bounded by time (10 ms), so a slow host gets fewer rows per slice, never more; before, the 300 came in one.
  expect(Math.max(...seen.batches)).toBeLessThan(150);
});

test('focus in the stock form draws every shelf row at once, so rows still to come cannot move the form (SHELF-2)', async ({ page, shell }) => {
  const stock = Array.from({ length: 300 }, (_, i) =>
    stockItem({ id: `s${i}`, glazeId: `g${i}`, name: `Glaze ${String(i).padStart(3, '0')}`, quantityG: 100 }),
  );
  await mockApi(page, { answers: { 'GET /api/stock': { json: stock } } });
  // A page that never gets idle time: the rows after the first ones would never arrive by themselves.
  await page.addInitScript(() => {
    window.requestIdleCallback = () => 0;
  });
  await shell.open('#/stock');
  const rows = main(page).locator('[data-stock-id]');
  await expect(rows).toHaveCount(SHELF_FIRST_ROWS);
  // Reached by hand (here the keyboard focuses the form's first field without the page scrolling for it).
  await main(page)
    .getByRole('combobox', { name: t('common.glaze') })
    .last()
    .focus();
  await expect(rows).toHaveCount(300);
});
