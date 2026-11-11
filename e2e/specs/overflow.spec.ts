import type { Page, TestInfo } from '@playwright/test';
import { adminPages } from '../../src/lib/routing/routes';
import { BISQUE_STEP, type Api } from '../support/api';
import { shortClubName } from '../../src/lib/stock/availability';
import { runPollsUntil } from '../support/feed-poll';
import { settled } from '../support/header';
import { formatMessage } from '../support/i18n';
import { photoPng, png } from '../support/images';
import { dictionaries, type Locale, locales } from '../support/locales';
import { MOCK_USER, mockApi } from '../support/mock-api';
import { grantSiteAdmin } from '../support/site-admin';
import { expect, newAccount, test } from '../support/test';

/**
 * Italian and Spanish are the longest texts of the app (LANG-1): on a phone no text may be wider than its box, cut off by a
 * box that hides overflow, broken inside a word, or run off the screen, and the page never scrolls sideways. Each screen is
 * measured and photographed (the test's output folder) in both languages; the screens with the known tight spots (the search
 * and the other fields' placeholders, the Explore sort, Studio's step header, the terms title) also in every language at 320
 * and 390 px (LANG-3, LANG-4, LANG-6).
 */

type Key = keyof (typeof dictionaries)['en'];

/** A word without the punctuation around it ("codes," and "codes" are one word). */
const bare = (word: string) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
/** Words are split at spaces, hyphens and slashes, where a line may break. */
const WORDS = /[^\s\-\u2010\u2011/\u00ad]+/g;
/** The words of the app's own texts in a language: the only words the broken-word check looks at (user text may break anywhere). */
const wordsOf = (locale: Locale) => [...new Set(Object.values(dictionaries[locale]).flatMap((text) => (text.match(WORDS) ?? []).map(bare)))].filter(Boolean);

/**
 * What on the page is wider than its box, clipped by a box that hides overflow, broken inside a word, or off the screen; empty
 * when all fits, and a placeholder or a select's option cut off by its field. `words` are the words of the app's own texts
 * (`wordsOf`), the only ones the broken-word check looks at.
 */
async function overflowing(page: Page, words: string[]): Promise<string[]> {
  // The emulated phone's width, not innerWidth: a mobile browser widens its layout viewport to a page that is too wide.
  return page.evaluate(
    ([width, known, wordSource]) => {
      const problems: string[] = [];
      const name = (element: Element) =>
        `${element.tagName.toLowerCase()}${element.className && typeof element.className === 'string' ? '.' + element.className.trim().split(/\s+/).join('.') : ''} "${(element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 60)}"`;
      if (document.documentElement.scrollWidth > width) {
        // Name the innermost elements that reach past the screen, so the report says what to fix.
        const clipped = (element: Element) => {
          for (let up = element.parentElement; up && up !== document.body; up = up.parentElement) if (getComputedStyle(up).overflowX !== 'visible') return true;
          return false;
        };
        const past = [...document.body.querySelectorAll('*')].filter((element) => element.getBoundingClientRect().right > width + 0.5 && !clipped(element));
        const innermost = past.filter((element) => !past.some((other) => other !== element && element.contains(other)));
        problems.push(`page scrolls sideways: ${document.documentElement.scrollWidth} > ${width} (${innermost.slice(0, 3).map(name).join('; ')})`);
      }
      const hidden = (element: Element) => !!element.closest('.visually-hidden, [inert], [aria-hidden="true"]');
      const scrolls = (style: CSSStyleDeclaration) => style.overflowX === 'auto' || style.overflowX === 'scroll';
      const selector = 'button, a, summary, label, legend, select, h1, h2, h3, th, td, [role="tab"], [role="option"], .button';
      for (const element of document.querySelectorAll<HTMLElement>(selector)) {
        if (hidden(element) || !element.checkVisibility({ visibilityProperty: true })) continue;
        const box = element.getBoundingClientRect();
        if (box.width < 2 || box.height < 2) continue;
        const style = getComputedStyle(element);
        // An inline link in a sentence has no box of its own to overflow (clientWidth 0); a select's text is not in the DOM.
        if (element.clientWidth > 0 && element.tagName !== 'SELECT' && !scrolls(style) && element.scrollWidth > element.clientWidth + 1) {
          problems.push(`wider than its box (${element.scrollWidth} > ${element.clientWidth}): ${name(element)}`);
        }
        if ((style.overflowY === 'hidden' || style.overflowY === 'clip') && element.scrollHeight > element.clientHeight + 1) {
          problems.push(`cut off at the bottom (${element.scrollHeight} > ${element.clientHeight}): ${name(element)}`);
        }
        let ancestor = element.parentElement;
        while (ancestor && ancestor !== document.body) {
          const outer = getComputedStyle(ancestor);
          if (outer.overflowX !== 'visible') {
            const bounds = ancestor.getBoundingClientRect();
            if (!scrolls(outer) && (box.right > bounds.right + 1 || box.left < bounds.left - 1))
              problems.push(`cut off by ${name(ancestor).split(' ')[0]}: ${name(element)}`);
            break;
          }
          ancestor = ancestor.parentElement;
        }
        if (!ancestor && (box.right > width + 0.5 || box.left < -0.5))
          problems.push(`off the screen (${Math.round(box.left)}..${Math.round(box.right)}): ${name(element)}`);
      }
      // A grid whose column grew past its own box to fit an item's longest word (a plain `1fr` column): the page's side padding
      // may hide a few pixels, a longer word scrolls the page (LANG-6, the Explore list at 320 px).
      for (const grid of document.querySelectorAll<HTMLElement>('body *')) {
        const style = getComputedStyle(grid);
        if (!style.display.endsWith('grid') || scrolls(style) || hidden(grid) || !grid.checkVisibility({ visibilityProperty: true })) continue;
        if (grid.clientWidth > 0 && grid.scrollWidth > grid.clientWidth + 1)
          problems.push(`grid wider than its box (${grid.scrollWidth} > ${grid.clientWidth}): ${name(grid).slice(0, 80)}`);
      }
      // A word broken across lines (LANG-4: "Pas/sag/gio 2" in a `strong`): the box fits because the text wraps inside the word,
      // so nothing above sees it. Every visible word of the app's own texts must sit on one line, whatever element holds it
      // (names and other user text may break anywhere: a shared test library holds 64-letter names); text with `hyphens: auto`
      // may break with its hyphen.
      const words = new RegExp(wordSource, 'g');
      const ownWords = new Set(known);
      const range = document.createRange();
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
        const parent = node.parentElement;
        if (!parent || !node.data.trim() || hidden(parent) || !parent.checkVisibility({ visibilityProperty: true })) continue;
        if (getComputedStyle(parent).hyphens === 'auto') continue;
        for (const match of node.data.matchAll(words)) {
          if (!ownWords.has(match[0].replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))) continue;
          range.setStart(node, match.index);
          range.setEnd(node, match.index + match[0].length);
          const lines = new Set([...range.getClientRects()].filter((rect) => rect.width > 0).map((rect) => Math.round(rect.bottom)));
          if (lines.size > 1) problems.push(`word broken across ${lines.size} lines: "${match[0]}" in ${name(parent)}`);
        }
      }
      // A placeholder cut off by its field (the field shows no scrollbar for it): measured with the field's font.
      const context = document.createElement('canvas').getContext('2d')!;
      for (const field of document.querySelectorAll<HTMLInputElement>('input[placeholder]:not([type="hidden"])')) {
        if (hidden(field) || field.value || !field.checkVisibility({ visibilityProperty: true })) continue;
        const style = getComputedStyle(field);
        context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const room = field.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        const needed = context.measureText(field.placeholder).width;
        if (needed > room + 1) problems.push(`placeholder cut off (${Math.round(needed)} > ${Math.round(room)}): "${field.placeholder}"`);
      }
      // A select shows its chosen option in a box the page cannot read (the text is not in the DOM, so nothing above sees it cut):
      // a copy holding only that option, free of the width limits, takes the width the option needs (padding and arrow included);
      // every option is tried, since each one is shown once chosen.
      for (const select of document.querySelectorAll<HTMLSelectElement>('select')) {
        if (hidden(select) || !select.checkVisibility({ visibilityProperty: true })) continue;
        const shown = select.getBoundingClientRect().width;
        for (const option of select.options) {
          const copy = select.cloneNode(false) as HTMLSelectElement;
          copy.removeAttribute('id');
          copy.append(option.cloneNode(true));
          copy.style.cssText += ';position:absolute;visibility:hidden;width:auto;min-width:0;max-width:none;flex:none';
          select.after(copy);
          const needed = copy.getBoundingClientRect().width;
          copy.remove();
          if (needed > shown + 1) problems.push(`select option cut off (${Math.round(needed)} > ${Math.round(shown)}): "${option.text.trim()}"`);
        }
      }
      return [...new Set(problems)];
    },
    [page.viewportSize()!.width, words, WORDS.source] as const,
  );
}

class Screens {
  readonly found: Record<string, string[]> = {};
  private count = 0;
  constructor(
    private readonly page: Page,
    private readonly locale: Locale,
    private readonly info: TestInfo,
  ) {}

  /** Measures and photographs what is shown now. */
  async check(screen: string) {
    await settled(this.page);
    this.count++;
    const file = `${this.locale}-${String(this.count).padStart(2, '0')}-${screen}`;
    // What the phone shows (fixed and sticky bars where they are), and the whole page.
    await this.page.screenshot({ path: this.info.outputPath(`${file}.png`) });
    await this.page.screenshot({ path: this.info.outputPath(`${file}-full.png`), fullPage: true });
    this.found[screen] = await overflowing(this.page, wordsOf(this.locale));
  }

  expectAllFit() {
    const problems = Object.fromEntries(Object.entries(this.found).filter(([, list]) => list.length));
    return expect(problems, `${this.locale}: ${Object.keys(this.found).length} screens`).toEqual({});
  }
}

/** The key's text with `{placeholders}` filled from `values`. */
const say = (locale: Locale, key: Key, values: Record<string, string | number> = {}) =>
  dictionaries[locale][key].replace(/\{(\w+)\}/g, (whole, name: string) => String(values[name] ?? whole));
/** The key's text formatted as the app does it, for a message with a plural (`{count, plural, …}`). */
const sayFormatted = (locale: Locale, key: Key, values: Record<string, string | number>) => formatMessage(dictionaries[locale][key], values, key);
/** A name that starts with the key's text up to its first placeholder, for names composed with a count or a title. */
const startingWith = (locale: Locale, key: Key) =>
  new RegExp(
    '^' +
      dictionaries[locale][key]
        .split('{')[0]
        .trim()
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  );

async function seed(api: Api, uid: string) {
  const shortId = `L${uid.slice(-8).toUpperCase()}`;
  const glaze = await api.addGlaze({ newManufacturer: { name: `Fornace ${uid}`, shortId }, code: 'PC-20', name: `Celadon ${uid}`, notes: 'Cono 6' });
  const other = await api.addGlaze({ manufacturerId: glaze.glaze.manufacturer.id, code: 'PC-21', name: `Ñandú ${uid}` });
  await api.addStock({ glazeId: glaze.id, ownerType: 'personal', quantityG: 400, jarSizeG: 500 });
  await api.addStock({ glazeId: other.id, ownerType: 'personal', quantityG: 0, jarSizeG: 250 });
  const steps = [
    { type: 'GLAZE' as const, glazeId: glaze.id, coats: 2, method: 'Dip' },
    { type: 'GLAZE' as const, glazeId: other.id, coats: 1, method: 'Brush' },
  ];
  const combination = await api.addCombination({ title: `Città ${uid}`, steps, tags: ['satin-matte'] });
  const { club } = await api.clubWithInvite(`Club ${uid}`);
  return { glaze: glaze.id, combination, club: club.id };
}

for (const locale of ['it', 'es'] as const) {
  test.describe(`on a phone in ${locale}`, () => {
    test.beforeEach(async ({ page, isMobile }) => {
      test.skip(!isMobile, 'the phone layout is where the long texts run out of room');
      await page.addInitScript((value) => {
        try {
          localStorage.setItem('glazelab:locale', value);
        } catch {
          // about:blank has no storage.
        }
      }, locale);
    });

    test(`the signed-in screens and their dialogs fit (${locale})`, async ({ page, api, signedIn, uid }, info) => {
      test.setTimeout(150_000);
      const { glaze, combination, club } = await seed(api, uid);
      await grantSiteAdmin(signedIn.email);
      const screens = new Screens(page, locale, info);
      const main = page.getByRole('main');
      const h1 = () => main.getByRole('heading', { level: 1 }).first();

      await page.goto('/#/');
      await expect(main.getByRole('link', { name: startingWith(locale, 'discover.quick.canMake') })).toBeVisible();
      await screens.check('explore');
      await page.goto('/#/?quick=available');
      await expect(main.getByRole('link', { name: startingWith(locale, 'discover.quick.available') })).toHaveAttribute('aria-current', 'page');
      await screens.check('explore-available');
      await page.goto('/#/?quick=shelf&type=glazes');
      await expect(main.getByRole('group', { name: say(locale, 'discover.shelfStock.label') })).toBeVisible();
      await screens.check('explore-shelf');
      await main.getByRole('button', { name: startingWith(locale, 'discover.filters.open') }).click();
      await expect(page.getByRole('dialog', { name: say(locale, 'discover.filters.title') })).toBeVisible();
      await screens.check('explore-filter-sheet');
      await page.keyboard.press('Escape');

      await page.goto(`/#/glazes/${glaze}`);
      await expect(h1()).toBeVisible();
      await screens.check('glaze');
      await page.goto(`/#/combinations/${combination}`);
      await expect(h1()).toBeVisible();
      await screens.check('combination');
      await main
        .getByRole('button', { name: startingWith(locale, 'images.addFinished') })
        .first()
        .click();
      const upload = page.getByRole('dialog');
      await upload.getByLabel(say(locale, 'upload.library')).setInputFiles(png('finished.png'));
      await expect(upload.getByRole('region', { name: say(locale, 'vision.consent.title') })).toBeVisible();
      await screens.check('upload-dialog');
      // The focus dialog over it (this small photo also shows the refusal text).
      await upload.getByRole('button', { name: say(locale, 'upload.focus.openNamed', { name: 'finished.png' }) }).click();
      const frame = page.getByRole('dialog', { name: say(locale, 'upload.focus.title') });
      await expect(frame.getByRole('alert')).toBeVisible();
      await screens.check('focus-dialog');
      await frame.getByRole('button', { name: say(locale, 'common.cancel'), exact: true }).click();
      await expect(frame).toBeHidden();
      await upload.getByRole('button', { name: say(locale, 'common.close'), exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await main.getByRole('button', { name: say(locale, 'combination.delete.confirm'), exact: true }).click();
      await expect(page.getByRole('dialog', { name: say(locale, 'combination.delete.title') })).toBeVisible();
      await screens.check('confirm-dialog');
      await page.keyboard.press('Escape');

      await page.goto('/#/stock');
      await expect(h1()).toHaveText(say(locale, 'stock.title'));
      await screens.check('shelf');
      await page.goto('/#/studio');
      await expect(h1()).toBeVisible();
      await screens.check('studio');
      await main.getByLabel(say(locale, 'studio.titleLabel')).fill(`Prova ${uid}`);
      await main
        .getByRole('button', { name: say(locale, 'studio.addGlazeStep') })
        .first()
        .click();
      await expect(main.getByRole('combobox', { name: say(locale, 'common.glaze') }).last()).toBeVisible();
      await screens.check('studio-sticky-bar');
      await page.goto('about:blank');
      await page.goto('/#/clubs');
      await expect(main.getByRole('heading', { name: `Club ${uid}` })).toBeVisible();
      await screens.check('clubs');
      await page.goto(`/#/clubs/${club}`);
      await expect(h1()).toHaveText(`Club ${uid}`);
      await screens.check('club');
      await page.goto('/#/account');
      await expect(h1()).toBeVisible();
      await screens.check('account');
      await page.getByRole('button', { name: say(locale, 'header.accountMenu', { name: signedIn.displayName }) }).click();
      await expect(page.getByRole('combobox', { name: say(locale, 'language.label') })).toBeVisible();
      await screens.check('account-menu-language');
      await page.keyboard.press('Escape');

      await page.goto('/#/admin');
      await expect(main.getByRole('list').getByRole('link')).toHaveCount(adminPages.length);
      await screens.check('admin');
      for (const name of adminPages) {
        await page.goto(`/#/admin/${name}`);
        await expect(h1()).toBeVisible();
        await screens.check(`admin-${name}`);
      }
      await page.goto('/#/terms');
      await expect(main.getByText(say(locale, 'terms.translationNote'))).toBeVisible();
      await screens.check('terms');
      screens.expectAllFit();
    });

    test(`the guest's sign-in dialog and the terms in it fit (${locale})`, async ({ page }, info) => {
      const screens = new Screens(page, locale, info);
      await page.goto('/#/');
      await expect(page.getByRole('main').getByRole('heading', { level: 1 }).first()).toBeVisible();
      await screens.check('guest-explore');
      await page
        .getByRole('banner')
        .getByRole('button', { name: say(locale, 'common.signIn'), exact: true })
        .click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await screens.check('sign-in-dialog');
      await dialog.getByRole('button', { name: say(locale, 'auth.register.switch'), exact: true }).click();
      await dialog.getByText(say(locale, 'auth.terms.read')).click();
      await expect(dialog.getByText(say(locale, 'terms.translationNote'))).toBeVisible();
      await screens.check('register-terms');
      screens.expectAllFit();
    });

    test(`the blocking terms dialog with the translation note fits (${locale})`, async ({ page }, info) => {
      const screens = new Screens(page, locale, info);
      await mockApi(page, { user: { ...MOCK_USER, acceptedTermsVersion: null } });
      await page.goto('/#/');
      const dialog = page.getByRole('dialog', { name: say(locale, 'terms.update.title') });
      await expect(dialog).toBeVisible();
      await screens.check('terms-dialog');
      await dialog.getByText(say(locale, 'auth.terms.read')).click();
      await expect(dialog.getByText(say(locale, 'terms.translationNote'))).toBeVisible();
      await screens.check('terms-dialog-open');
      screens.expectAllFit();
    });
  });
}

for (const locale of locales) {
  test(`the phone's fields, the sort and the terms title fit at 320 and 390 px (${locale})`, async ({ page, isMobile, api, signedIn, uid }, info) => {
    test.skip(!isMobile, 'the phone layout is where the long texts run out of room');
    test.setTimeout(150_000);
    void signedIn;
    const glaze = await api.addGlaze({
      newManufacturer: { name: `Fornace ${uid}`, shortId: `L${uid.slice(-8).toUpperCase()}` },
      code: 'PC-20',
      name: `Celadon ${uid}`,
      notes: 'Cone 6, glossy and translucent.',
    });
    // A glaze row with its photo.
    await api.uploadToGlaze(glaze.id, { file: photoPng('own.png', 480, 360) });
    const combination = await api.addCombination({ title: `Prova ${uid}`, steps: [{ type: 'GLAZE', glazeId: glaze.id, coats: 2, method: 'Dip' }], tags: [] });
    // A combination card with its two photos (a plain 1fr phone column grew to it and pushed the page past 320 px).
    await api.uploadToCombination(combination, { file: photoPng('tile.png', 480, 360), kind: 'TEST_TILE' });
    await api.uploadToCombination(combination, { file: photoPng('bowl.png', 480, 360), kind: 'FINISHED' });
    // A club with stock on both shelves: the shelf's scope header, chips and the buttons that name it (SHELF-3).
    const clubName = `Céramique ${uid}`;
    const club = (await api.createClub(clubName)).id;
    await api.addStock({ glazeId: glaze.id, ownerType: 'personal', quantityG: 400 });
    await api.addStock({ glazeId: glaze.id, ownerType: 'club', clubId: club, quantityG: 1200 });
    await page.addInitScript((value) => {
      try {
        localStorage.setItem('glazelab:locale', value);
      } catch {
        // about:blank has no storage.
      }
    }, locale);
    const main = page.getByRole('main');
    const found: Record<string, string[]> = {};
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      const check = async (screen: string) => {
        await settled(page);
        await page.screenshot({ path: info.outputPath(`${locale}-${width}-${screen}.png`) });
        found[`${width} ${screen}`] = await overflowing(page, wordsOf(locale));
      };
      await page.goto('about:blank');
      await page.goto('/#/');
      await expect(main.getByRole('textbox', { name: say(locale, 'discover.search.label') })).toHaveAttribute(
        'placeholder',
        say(locale, 'discover.search.placeholder'),
      );
      await check('explore');
      await main.getByRole('button', { name: startingWith(locale, 'discover.filters.open') }).click();
      await expect(page.getByRole('dialog', { name: say(locale, 'discover.filters.title') })).toBeVisible();
      await check('explore-filter-sheet');
      await page.keyboard.press('Escape');
      // A search shows the glaze row and the combination card without photos.
      await page.goto(`/#/?q=${uid}`);
      await expect(main.getByRole('heading', { level: 3, name: `Celadon ${uid}` })).toBeVisible();
      await expect(main.getByRole('heading', { level: 3, name: `Prova ${uid}` })).toBeVisible();
      await main.getByRole('heading', { level: 3, name: `Celadon ${uid}` }).scrollIntoViewIfNeeded();
      await check('explore-results');
      // The glazes add an order by code to the sort.
      await page.goto('/#/?type=glazes');
      await expect(main.getByRole('combobox', { name: say(locale, 'discover.sort.label') })).toBeVisible();
      await check('explore-glazes');
      await main
        .getByRole('button', { name: say(locale, 'addGlaze.action'), exact: true })
        .first()
        .click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await check('add-glaze-dialog');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await page.goto('/#/stock');
      await expect(main.getByRole('heading', { level: 1 })).toHaveText(say(locale, 'stock.title'));
      await check('shelf');
      await page.goto(`/#/stock?shelf=${club}&glaze=${glaze.id}`);
      await expect(main.getByRole('region', { name: say(locale, 'stock.scope.label') })).toContainText(clubName);
      await check('shelf-club');
      const update = main.getByRole('button', { name: say(locale, 'stock.target.updateClub', { club: clubName }), exact: true });
      await update.scrollIntoViewIfNeeded();
      await check('shelf-club-form');
      await page.goto(`/#/glazes/${glaze.id}`);
      await expect(main.getByRole('heading', { level: 1 })).toBeVisible();
      await check('glaze');
      await main.getByRole('button', { name: say(locale, 'barcodes.editLabel'), exact: true }).click();
      await expect(main.getByRole('textbox', { name: say(locale, 'barcodes.add') })).toBeVisible();
      await check('glaze-barcodes');
      await page.goto('about:blank');
      await page.goto('/#/studio');
      if (width === 320) {
        await main.getByLabel(say(locale, 'studio.titleLabel')).fill(`Prova ${uid}`);
        await main
          .getByRole('button', { name: say(locale, 'studio.addGlazeStep') })
          .first()
          .click();
        await main
          .getByRole('button', { name: say(locale, 'studio.addCustomStep') })
          .last()
          .click();
      } else {
        // The draft of the first width waits in the device's recovery copy.
        await main.getByRole('button', { name: say(locale, 'studio.recovery.restore'), exact: true }).click();
      }
      const second = main.getByText(`${say(locale, 'studio.step.title')} 2`, { exact: true }).first();
      await expect(second).toBeVisible();
      await second.scrollIntoViewIfNeeded();
      await check('studio-steps');
      // The final firing is folded on phones.
      const firing = main.getByRole('button', { name: startingWith(locale, 'firing.title') });
      await firing.click();
      await expect(firing).toHaveAttribute('aria-expanded', 'true');
      await firing.scrollIntoViewIfNeeded();
      await check('studio-firing');
      // Photos attached while recording: the file row, its fields and the counter.
      await main.getByLabel(say(locale, 'upload.library')).setInputFiles(png('IMG_20261110_181512_glaze_test_tile_cone6.png'));
      const kind = main.getByRole('combobox', { name: say(locale, 'upload.kind') });
      await kind.scrollIntoViewIfNeeded();
      await check('studio-photos');
      // The focus dialog of that photo (it is too small to open, so the refusal shows too).
      const photoName = 'IMG_20261110_181512_glaze_test_tile_cone6.png';
      await main.getByRole('button', { name: say(locale, 'upload.focus.openNamed', { name: photoName }) }).click();
      const frame = page.getByRole('dialog', { name: say(locale, 'upload.focus.title') });
      await expect(frame.getByRole('alert')).toBeVisible();
      await check('focus-dialog');
      await frame.getByRole('button', { name: say(locale, 'common.cancel'), exact: true }).click();
      await expect(frame).toBeHidden();
      await page.goto('about:blank');
      await page.goto('/#/terms');
      await expect(main.getByRole('heading', { level: 1, name: say(locale, 'terms.title') })).toBeVisible();
      await check('terms');
    }
    expect(Object.fromEntries(Object.entries(found).filter(([, list]) => list.length)), `${locale}: ${Object.keys(found).length} screens`).toEqual({});
  });
}

for (const locale of locales) {
  test(`the activity page with its badge and the account's activity switches fit at 320 and 390 px (${locale})`, async ({
    page,
    isMobile,
    api,
    newApi,
    signedIn,
    uid,
  }, info) => {
    test.skip(!isMobile, 'the phone layout is where the long texts run out of room');
    test.setTimeout(90_000);
    void signedIn;
    // A buddy with long names publishes and shelves, a member joins the club and adds to its shelf: every entry type but one's own.
    const buddy = await newApi();
    await buddy.signUp({ ...newAccount(uid, 'Ada'), displayName: `Adalberta Konstantinopoulou ${uid}` });
    await api.requestBuddyByLink(await buddy.replaceBuddyLink());
    await buddy.acceptBuddy((await api.me()).id);
    const glaze = await api.addGlaze({
      newManufacturer: { name: `Fornace ${uid}`, shortId: `L${uid.slice(-8).toUpperCase()}` },
      code: 'PC-20',
      name: `Celadon ${uid}`,
    });
    await buddy.addCombination({ title: `Celadon su gres porcellanato ${uid}`, steps: [{ type: 'GLAZE', glazeId: glaze.id, coats: 2 }] });
    await buddy.addStock({ glazeId: glaze.id, ownerType: 'personal', quantityG: 300 });
    const { club, token } = await api.clubWithInvite(`Céramique du dimanche ${uid}`);
    const member = await newApi();
    await member.signUp({ ...newAccount(uid, 'Ben'), displayName: `Bartholomäus ${uid}` });
    await member.joinClub(token);
    await member.addStock({ glazeId: glaze.id, ownerType: 'club', clubId: club.id, quantityG: 500 });
    await page.addInitScript((value) => {
      try {
        localStorage.setItem('glazelab:locale', value);
      } catch {
        // about:blank has no storage.
      }
    }, locale);
    const main = page.getByRole('main');
    const found: Record<string, string[]> = {};
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      const check = async (screen: string) => {
        await settled(page);
        await page.screenshot({ path: info.outputPath(`${locale}-${width}-${screen}.png`), fullPage: true });
        found[`${width} ${screen}`] = await overflowing(page, wordsOf(locale));
      };
      await page.goto('about:blank');
      await page.goto('/#/');
      // The badge in the top bar, before the page was seen (the first width only: the visit marks it seen).
      if (width === 320) {
        await expect(page.getByRole('banner').getByRole('link', { name: sayFormatted(locale, 'feed.openUnread', { count: 5 }) })).toBeVisible();
        await check('header-badge');
      }
      await page.goto('/#/activity');
      await expect(main.getByRole('heading', { level: 1, name: say(locale, 'feed.title') })).toBeVisible();
      await expect(main.getByRole('listitem')).toHaveCount(5);
      await check('activity');
      await page.goto('/#/account');
      const section = main.getByRole('switch', { name: say(locale, 'account.feed.clubs') });
      await section.scrollIntoViewIfNeeded();
      await check('account-activity');
    }
    expect(Object.fromEntries(Object.entries(found).filter(([, list]) => list.length)), `${locale}: ${Object.keys(found).length} screens`).toEqual({});
  });
}

for (const locale of locales) {
  test(`the feedback dialog and the admins' Feedback page fit at 320 and 390 px (${locale})`, async ({ page, isMobile, api, signedIn, uid }, info) => {
    test.skip(!isMobile, 'the phone layout is where the long texts run out of room');
    test.setTimeout(90_000);
    await api.sendFeedback(`Die Glasurliste springt beim Scannen nach oben, wenn ich das Regal öffne ${uid}`, 'stock');
    await grantSiteAdmin(signedIn.email);
    await page.addInitScript((value) => {
      try {
        localStorage.setItem('glazelab:locale', value);
      } catch {
        // about:blank has no storage.
      }
    }, locale);
    const main = page.getByRole('main');
    const found: Record<string, string[]> = {};
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      const check = async (screen: string) => {
        await settled(page);
        await page.screenshot({ path: info.outputPath(`${locale}-${width}-${screen}.png`), fullPage: true });
        found[`${width} ${screen}`] = await overflowing(page, wordsOf(locale));
      };
      await page.goto('about:blank');
      await page.goto('/#/stock');
      await page
        .locator('footer')
        .getByRole('button', { name: say(locale, 'feedback.open') })
        .click();
      const dialog = page.getByRole('dialog', { name: say(locale, 'feedback.title') });
      await expect(dialog).toBeVisible();
      await dialog.getByRole('textbox').fill('Kurz');
      await dialog.locator('input[type="file"]').setInputFiles([png('overflow.png')]);
      await expect(dialog.getByRole('img')).toHaveCount(1);
      await check('feedback-dialog');
      await dialog.getByRole('button', { name: say(locale, 'common.cancel') }).click();
      await page.goto('/#/admin/feedback');
      await expect(main.locator('.feedback-admin__entry').filter({ hasText: uid })).toBeVisible();
      await check('feedback-admin');
    }
    expect(Object.fromEntries(Object.entries(found).filter(([, list]) => list.length)), `${locale}: ${Object.keys(found).length} screens`).toEqual({});
  });
}

for (const locale of locales) {
  test(`the combination page's Rename and Correct title with their dialogs fit at 320 and 390 px (${locale})`, async ({
    page,
    isMobile,
    api,
    newApi,
    signedIn,
    uid,
  }, info) => {
    test.skip(!isMobile, 'the phone layout is where the long texts run out of room');
    test.setTimeout(90_000);
    const own = await api.addCombination({ title: `Seladon über Shino mit Aschenglasur ${uid}`, steps: [BISQUE_STEP] });
    const author = await newApi();
    await author.signUp(newAccount(uid, 'Cleo'));
    const theirs = await author.addCombination({ title: `Tenmoku über Holzasche ${uid}`, steps: [BISQUE_STEP] });
    await grantSiteAdmin(signedIn.email);
    await page.addInitScript((value) => {
      try {
        localStorage.setItem('glazelab:locale', value);
      } catch {
        // about:blank has no storage.
      }
    }, locale);
    const main = page.getByRole('main');
    const found: Record<string, string[]> = {};
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      const check = async (screen: string) => {
        await settled(page);
        await page.screenshot({ path: info.outputPath(`${locale}-${width}-${screen}.png`), fullPage: true });
        found[`${width} ${screen}`] = await overflowing(page, wordsOf(locale));
      };
      for (const [id, control, heading] of [
        [own, 'combination.rename', 'combination.rename.title'],
        [theirs, 'combination.correctTitle', 'combination.correctTitle'],
      ] as const) {
        await page.goto('about:blank');
        await page.goto(`/#/combinations/${id}`);
        const button = main.getByRole('button', { name: say(locale, control), exact: true });
        await expect(button).toBeVisible();
        await check(`${control}-page`);
        await button.click();
        const dialog = page.getByRole('dialog', { name: say(locale, heading) });
        await expect(dialog).toBeVisible();
        await check(`${control}-dialog`);
        await dialog.getByRole('button', { name: say(locale, 'common.cancel') }).click();
      }
    }
    expect(Object.fromEntries(Object.entries(found).filter(([, list]) => list.length)), `${locale}: ${Object.keys(found).length} screens`).toEqual({});
  });

  test(`the photo menu and its type dialog fit at 320 and 390 px (${locale})`, async ({ page, isMobile, api, signedIn, uid }, info) => {
    test.skip(!isMobile, 'the phone layout is where the long texts run out of room');
    test.setTimeout(90_000);
    const title = `Unterglasur-Probeschale ${uid}`;
    const id = await api.addCombination({ title, steps: [{ type: 'CUSTOM', label: 'Schrühbrand' }] });
    await api.uploadToCombination(id, { file: photoPng('progress.png', 480, 360), kind: 'IN_PROGRESS' });
    await page.addInitScript((value) => {
      try {
        localStorage.setItem('glazelab:locale', value);
      } catch {
        // about:blank has no storage.
      }
    }, locale);
    const found: Record<string, string[]> = {};
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      const check = async (screen: string) => {
        await settled(page);
        await page.screenshot({ path: info.outputPath(`${locale}-${width}-${screen}.png`), fullPage: true });
        found[`${width} ${screen}`] = await overflowing(page, wordsOf(locale));
      };
      await page.goto('about:blank');
      await page.goto(`/#/combinations/${id}`);
      await expect(page.getByRole('main').getByText(say(locale, 'images.kind.inProgress')).first()).toBeVisible();
      await page.getByRole('button', { name: say(locale, 'images.menu.label') }).click();
      await expect(page.getByRole('menuitem', { name: say(locale, 'images.menu.kind') })).toBeVisible();
      await check('photo-menu');
      await page.getByRole('menuitem', { name: say(locale, 'images.menu.kind') }).click();
      const dialog = page.getByRole('dialog', { name: say(locale, 'images.menu.kind') });
      await expect(dialog).toBeVisible();
      await check('photo-type-dialog');
      await dialog.getByRole('button', { name: say(locale, 'common.cancel') }).click();
    }
    void signedIn;
    expect(Object.fromEntries(Object.entries(found).filter(([, list]) => list.length)), `${locale}: ${Object.keys(found).length} screens`).toEqual({});
  });

  test(`club availability with long club names fits at 320 and 390 px (${locale})`, async ({ page, isMobile, api, signedIn, uid }, info) => {
    test.skip(!isMobile, 'the phone layout is where the long texts run out of room');
    test.setTimeout(90_000);
    void signedIn;
    // Three clubs (one name without a space) hold one glaze, the spaceless one alone holds the other; the personal shelf holds neither.
    const names = [`Associação Cerâmica da Margem Sul ${uid}`, `BergischeKeramikwerkstattgemeinschaft${uid}`, `Comunità della ceramica di Faenza ${uid}`];
    const clubs = [];
    for (const name of names) clubs.push(await api.createClub(name));
    const glaze = await api.addGlaze({
      newManufacturer: { name: `Fornace ${uid}`, shortId: `L${uid.slice(-8).toUpperCase()}` },
      code: 'PC-20',
      name: `Celadon ${uid}`,
    });
    const other = await api.addGlaze({ manufacturerId: glaze.glaze.manufacturer.id, code: 'PC-21', name: `Ñandú ${uid}` });
    for (const club of clubs) await api.addStock({ glazeId: glaze.id, ownerType: 'club', clubId: club.id, quantityG: 1500 });
    await api.addStock({ glazeId: other.id, ownerType: 'club', clubId: clubs[1].id, quantityG: 500 });
    const steps = [glaze.id, other.id].map((glazeId) => ({ type: 'GLAZE' as const, glazeId, coats: 2, method: 'Dip' }));
    const combination = await api.addCombination({ title: `Città ${uid}`, steps });
    await page.addInitScript((value) => {
      try {
        localStorage.setItem('glazelab:locale', value);
      } catch {
        // about:blank has no storage.
      }
    }, locale);
    const main = page.getByRole('main');
    const found: Record<string, string[]> = {};
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      const check = async (screen: string) => {
        await settled(page);
        await page.screenshot({ path: info.outputPath(`${locale}-${width}-${screen}.png`), fullPage: true });
        found[`${width} ${screen}`] = await overflowing(page, wordsOf(locale));
      };
      await page.goto('about:blank');
      await page.goto(`/#/combinations/${combination}`);
      const more = say(locale, 'combination.shelf.inClubsMore', { clubs: `${shortClubName(names[0])}, ${shortClubName(names[1])}`, more: 1 });
      await expect(main.getByText(more, { exact: true })).toBeVisible();
      await expect(
        main.getByText(sayFormatted(locale, 'combination.shelf.inClubs', { clubs: shortClubName(names[1]), count: 1 }), { exact: true }),
      ).toBeVisible();
      await check('combination');
      await page.goto(`/#/glazes/${glaze.id}`);
      await expect(main.getByText(new RegExp(`${names[2]}: 1[.,\\s  ]?500 g$`))).toBeVisible();
      await check('glaze');
      await page.goto(`/#/?type=glazes&q=${uid}&quick=available&clubs=1`);
      await expect(main.getByText(more, { exact: true })).toBeVisible();
      await check('explore-available');
    }
    expect(Object.fromEntries(Object.entries(found).filter(([, list]) => list.length)), `${locale}: ${Object.keys(found).length} screens`).toEqual({});
  });
}

for (const locale of locales) {
  test(`the club wishlist with long names, hosts and notes and its dialogs fit at 320 and 390 px (${locale})`, async ({
    page,
    isMobile,
    api,
    signedIn,
    uid,
  }, info) => {
    test.skip(!isMobile, 'the phone layout is where the long texts run out of room');
    test.setTimeout(90_000);
    void signedIn;
    const { id } = await api.createClub(`Associação Cerâmica da Margem Sul ${uid}`);
    const glaze = await api.addGlaze({
      newManufacturer: { name: `Fornace ${uid}`, shortId: `W${uid.slice(-8).toUpperCase()}` },
      code: 'PC-20-LONGCODEWITHOUTSPACES',
      name: `Celadonblaugrünschimmerndeglasur${uid}`,
    });
    await api.addWishlistEntry(id, { type: 'GLAZE', glazeId: glaze.id, note: `Für den Anfängerkurs am Donnerstagabend ${uid}` });
    const item = await api.addWishlistEntry(id, {
      type: 'ITEM',
      name: `Ofenplattenträgersystemerweiterungssatz${uid}`,
      link: `https://keramikbedarf-und-toepfereibedarf-fuer-werkstaetten-online.example.test/${'a'.repeat(300)}`,
      note: 'x'.repeat(200),
    });
    await api.setWishlistAcquired(id, item.id, true);
    await page.addInitScript((value) => {
      try {
        localStorage.setItem('glazelab:locale', value);
      } catch {
        // about:blank has no storage.
      }
    }, locale);
    const screens = new Screens(page, locale, info);
    const wishlist = page.locator('#club-wishlist');
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto('about:blank');
      await page.goto(`/#/clubs/${id}`);
      await expect(wishlist.getByRole('listitem')).toHaveCount(2);
      await wishlist.scrollIntoViewIfNeeded();
      await screens.check(`${width}-wishlist`);
      await wishlist.getByRole('button', { name: say(locale, 'clubs.wishlist.addItem') }).click();
      const dialog = page.getByRole('dialog', { name: say(locale, 'clubs.wishlist.itemTitle') });
      await dialog.getByRole('textbox', { name: say(locale, 'clubs.wishlist.itemName') }).fill('Kiln shelf');
      await dialog.getByRole('textbox', { name: say(locale, 'clubs.wishlist.link') }).fill('ftp://example.test');
      await dialog.getByRole('button', { name: say(locale, 'clubs.wishlist.submit') }).click();
      await expect(dialog.getByText(say(locale, 'errors.wishlistLinkInvalid'))).toBeVisible();
      await screens.check(`${width}-wishlist-item`);
      await dialog.getByRole('button', { name: say(locale, 'common.cancel') }).click();
      await wishlist.getByRole('button', { name: say(locale, 'clubs.wishlist.addGlaze') }).click();
      const glazeDialog = page.getByRole('dialog', { name: say(locale, 'clubs.wishlist.glazeTitle') });
      await expect(glazeDialog).toBeVisible();
      await screens.check(`${width}-wishlist-glaze`);
      await glazeDialog.getByRole('button', { name: say(locale, 'common.cancel') }).click();
    }
    await screens.expectAllFit();
  });
}

for (const locale of locales) {
  test(`the footer with the About, source code and licence links, and the About page, fit at 320 and 390 px, signed out and in (${locale})`, async ({
    page,
    isMobile,
    api,
    account,
  }, info) => {
    test.skip(!isMobile, 'the phone layout is where the long texts run out of room');
    await page.addInitScript((value) => {
      try {
        localStorage.setItem('glazelab:locale', value);
      } catch {
        // about:blank has no storage.
      }
    }, locale);
    const footer = page.locator('footer');
    const found: Record<string, string[]> = {};
    const check = async (screen: string) => {
      await expect(footer.getByRole('link', { name: say(locale, 'app.sourceCode'), exact: true })).toBeVisible();
      await expect(footer.getByRole('link', { name: say(locale, 'app.licences'), exact: true })).toBeVisible();
      await expect(footer.getByRole('link', { name: say(locale, 'about.link'), exact: true })).toBeVisible();
      await settled(page);
      await footer.scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath(`${locale}-${page.viewportSize()?.width}-${screen}.png`), fullPage: true });
      found[`${page.viewportSize()?.width} ${screen}`] = await overflowing(page, wordsOf(locale));
    };
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto('about:blank');
      await page.goto('/#/terms');
      await check('footer-guest');
      await page.goto('/#/about');
      await expect(page.getByRole('heading', { level: 1, name: say(locale, 'about.title') })).toBeVisible();
      await check('about-guest');
    }
    // Signed in, the footer also holds Feedback.
    await api.signIn(account);
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto('about:blank');
      await page.goto('/#/terms');
      await expect(footer.getByRole('button', { name: say(locale, 'feedback.open') })).toBeVisible();
      await check('footer-signed-in');
    }
    expect(Object.fromEntries(Object.entries(found).filter(([, list]) => list.length)), `${locale}: ${Object.keys(found).length} screens`).toEqual({});
  });
}

for (const locale of locales) {
  test(`the activation with the terms and the error-report choice, and a delayed sign-in, fit at 320 and 390 px (${locale})`, async ({
    page,
    isMobile,
    newApi,
    uid,
  }, info) => {
    test.skip(!isMobile, 'the phone layout is where the long texts run out of room');
    await page.addInitScript((value) => {
      try {
        localStorage.setItem('glazelab:locale', value);
      } catch {
        // about:blank has no storage.
      }
    }, locale);
    const delayed = 'Too many failed sign-ins for this address. Please wait a few minutes or sign in with an email link.';
    await page.route('**/api/auth/login', (route) =>
      route.fulfill({ status: 429, headers: { 'Retry-After': '60' }, contentType: 'application/json', body: JSON.stringify({ error: delayed }) }),
    );
    const found: Record<string, string[]> = {};
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      const check = async (screen: string) => {
        await settled(page);
        await page.screenshot({ path: info.outputPath(`${locale}-${width}-${screen}.png`), fullPage: true });
        found[`${width} ${screen}`] = await overflowing(page, wordsOf(locale));
      };
      const registration = await (await newApi()).registration(newAccount(uid, `Pending${width}`));
      await page.goto('about:blank');
      await page.goto(`/#/verify/${registration.setupToken}`);
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: say(locale, 'account.link.verifyTitle'), exact: true }).click();
      await expect(dialog.getByRole('checkbox', { name: say(locale, 'account.link.diagnostics') })).toBeVisible();
      await check('activation');
      await dialog.getByRole('button', { name: say(locale, 'auth.diagnostics.link') }).click();
      await expect(dialog.getByRole('heading', { name: say(locale, 'terms.section.diagnostics.title') })).toBeInViewport();
      await check('activation-terms');

      await page.goto('about:blank');
      await page.goto('/#/');
      await page
        .getByRole('banner')
        .getByRole('button', { name: say(locale, 'common.signIn'), exact: true })
        .click();
      const signIn = page.getByRole('dialog');
      await signIn.getByLabel(say(locale, 'common.email')).fill(`delayed-${uid}@example.test`);
      await signIn.getByLabel(say(locale, 'auth.password')).fill('wrong-password');
      await signIn.getByRole('button', { name: say(locale, 'common.signIn'), exact: true }).click();
      await expect(signIn.getByText(say(locale, 'errors.signInDelayed'))).toBeVisible();
      await check('sign-in-delayed');
    }
    expect(Object.fromEntries(Object.entries(found).filter(([, list]) => list.length)), `${locale}: ${Object.keys(found).length} screens`).toEqual({});
  });
}

for (const locale of locales) {
  test(`the message for a QR code that could not be loaded fits at 320 and 390 px (${locale})`, async ({ page, isMobile, signedIn }, info) => {
    test.skip(!isMobile, 'the phone layout is where the long texts run out of room');
    void signedIn;
    await page.addInitScript((value) => {
      try {
        localStorage.setItem('glazelab:locale', value);
      } catch {
        // about:blank has no storage.
      }
    }, locale);
    // A page of an older build asks for a code chunk the server no longer has.
    await page.route(/\/assets\/QrCode-[\w-]+\.js$/, (route) => route.abort());
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto('/#/account');
    const main = page.getByRole('main');
    await main.getByRole('button', { name: say(locale, 'buddies.link.create') }).click();
    const problem = main.getByRole('alert').filter({ hasText: say(locale, 'qr.loadFailed') });
    const found: Record<string, string[]> = {};
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await problem.scrollIntoViewIfNeeded();
      await expect(main.getByRole('button', { name: say(locale, 'route.reload') })).toBeVisible();
      await settled(page);
      await page.screenshot({ path: info.outputPath(`${locale}-${width}-qr-load-failed.png`) });
      found[`${width}`] = await overflowing(page, wordsOf(locale));
    }
    expect(Object.fromEntries(Object.entries(found).filter(([, list]) => list.length)), `${locale}: QR load failed`).toEqual({});
  });
}

for (const locale of locales) {
  test(`the scanner's paused camera fits at 320 and 390 px (${locale})`, async ({ page, context, isMobile }, info) => {
    test.skip(!isMobile, 'the phone layout is where the long texts run out of room');
    // The suite's fake capture device (`playwright.config.ts`); a real camera is never reached.
    await context.grantPermissions(['camera']);
    await page.addInitScript((value) => {
      try {
        localStorage.setItem('glazelab:locale', value);
      } catch {
        // about:blank has no storage.
      }
    }, locale);
    await page.clock.install();
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto('/#/');
    await page
      .getByRole('main')
      .getByRole('button', { name: say(locale, 'barcodes.scan'), exact: true })
      .click();
    const scanner = page.getByRole('dialog', { name: say(locale, 'barcodes.scanner.findTitle') });
    const preview = scanner.getByLabel(say(locale, 'barcodes.scanner.camera'));
    const resume = scanner.getByRole('button', { name: say(locale, 'barcodes.scanner.resume') });
    const found: Record<string, string[]> = {};
    for (const [reason, key] of [
      ['idle', 'barcodes.scanner.pausedIdle'],
      ['away', 'barcodes.scanner.pausedAway'],
    ] as const) {
      await expect(preview).toBeVisible();
      // The idle limit starts once the camera is on.
      await expect(scanner.getByText(say(locale, 'barcodes.scanner.hint'))).toBeVisible();
      if (reason === 'idle') await page.clock.fastForward(2 * 60_000);
      // Headless Chromium keeps the page visible: the hidden state is set and announced as a background tab gets it.
      else
        await page.evaluate(() => {
          Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
          document.dispatchEvent(new Event('visibilitychange'));
          Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
        });
      await expect(scanner.getByText(say(locale, key))).toBeVisible();
      for (const width of [320, 390]) {
        await page.setViewportSize({ width, height: 844 });
        await settled(page);
        await page.screenshot({ path: info.outputPath(`${locale}-${width}-scanner-paused-${reason}.png`) });
        found[`${reason} ${width}`] = await overflowing(page, wordsOf(locale));
      }
      await resume.click();
    }
    expect(Object.fromEntries(Object.entries(found).filter(([, list]) => list.length)), `${locale}: scanner paused`).toEqual({});
  });
}

for (const locale of locales) {
  test(`the new buddy request toast fits at 320 and 390 px (${locale})`, async ({ page, isMobile, api, newApi, signedIn, uid }, info) => {
    test.skip(!isMobile, 'the phone layout is where the long texts run out of room');
    test.setTimeout(90_000);
    void signedIn;
    await page.addInitScript((value) => {
      try {
        localStorage.setItem('glazelab:locale', value);
      } catch {
        // about:blank has no storage.
      }
    }, locale);
    const toast = page.getByRole('status').locator('.app-shell__toast--request');
    const found: Record<string, string[]> = {};
    await page.clock.install();
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto('about:blank');
      await page.goto('/#/');
      await expect(page.getByRole('banner').getByRole('link', { name: startingWith(locale, 'feed.open') })).toBeVisible();
      // Two long-named accounts ask after the page loaded: first the single form, then the newest with the other counted.
      for (const [index, name] of [`Adalberta Konstantinopoulou ${width}`, `Bartholomäus Wolkenkratzer ${width}`].entries()) {
        const asker = await newApi();
        await asker.signUp({ ...newAccount(`${uid}${width}${index}`, 'Ask'), displayName: `${name} ${uid}` });
        await asker.requestBuddyByLink(await api.replaceBuddyLink());
        const text = sayFormatted(locale, 'feed.requestToast', { name: `${name} ${uid}`, others: index });
        await runPollsUntil(page, async () => (await toast.textContent())?.includes(text) ?? false);
        await expect(toast).toContainText(text);
        await settled(page);
        await page.screenshot({ path: info.outputPath(`${locale}-${width}-request-toast-${index}.png`), animations: 'disabled' });
        found[`${width} toast ${index}`] = await overflowing(page, wordsOf(locale));
      }
      // The next width starts again from a page that knows both requests: they are answered first.
      for (const buddy of (await api.buddies()).incoming) await api.declineBuddy(buddy.id);
    }
    expect(Object.fromEntries(Object.entries(found).filter(([, list]) => list.length)), `${locale}: ${Object.keys(found).length} screens`).toEqual({});
  });
}

test.describe('the measurement', () => {
  test('reports text wider than its box, text cut by a box that hides overflow, a grid wider than its box, a cut placeholder or select option, and a page that scrolls sideways', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 600 });
    await page.setContent(`<!doctype html><html lang="it"><head><meta name="viewport" content="width=device-width"></head><body style="margin:0">
      <button style="width:80px;white-space:nowrap">Aggiungi passaggio di smalto</button>
      <div style="width:100px;overflow:hidden"><a href="#" style="display:inline-block;white-space:nowrap">Disponibili per me adesso</a></div>
      <div style="width:100px;overflow-x:auto"><a href="#" style="display:inline-block;white-space:nowrap">Scorre di lato apposta</a></div>
      <h2 style="width:120px">Fits easily</h2>
      <div style="display:grid;grid-template-columns:1fr;width:100px"><span>Kombinationenkombination</span></div>
      <div style="display:grid;grid-template-columns:minmax(0,1fr);width:100px"><span>Kombinationenkombination</span></div>
      <h3 style="width:40px;overflow-wrap:anywhere">Passaggio 1</h3><h3 style="width:40px;overflow-wrap:anywhere">Longnamelongnamelongname</h3>
      <input style="width:80px;padding:0" placeholder="Escribe un código, fabricante o nombre"><input style="width:300px" placeholder="Corto">
      <select style="max-width:90px"><option>A–Z</option><option>Mais recentes por data</option></select><select><option>Mais recentes por data</option></select>
      <p style="width:600px">wide</p></body></html>`);
    const found = await overflowing(page, ['Passaggio']);
    expect(found).toEqual([
      expect.stringMatching(/^page scrolls sideways/),
      expect.stringMatching(/^wider than its box .*Aggiungi passaggio di smalto/),
      expect.stringMatching(/^cut off by div: a "Disponibili per me adesso"/),
      expect.stringMatching(/^grid wider than its box \(\d+ > 100\): div "Kombinationenkombination"/),
      expect.stringMatching(/^word broken across \d lines: "Passaggio" in h3/),
      expect.stringMatching(/^placeholder cut off \(\d+ > 80\): "Escribe un código, fabricante o nombre"$/),
      expect.stringMatching(/^select option cut off \(\d+ > 90\): "Mais recentes por data"$/),
    ]);
  });
});
