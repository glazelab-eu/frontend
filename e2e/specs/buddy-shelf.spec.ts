import type { Page } from '@playwright/test';
import type { Api } from '../support/api';
import { BISQUE_STEP } from '../support/api';
import { startsWith, t } from '../support/i18n';
import { expect, newAccount, test } from '../support/test';

/**
 * Buddy availability in the app (27-3): marks and summaries on the combination page, Ask Ada, "Include buddies" in "I can make
 * now", Keep private on the shelf, the glaze page, a removed buddy, offline. Ana is the signed-in account; Ada, Ben and others are
 * people in sessions of their own; Cy never becomes a buddy and Pat's request is never accepted.
 */
const main = (page: Page) => page.getByRole('main');

interface Person {
  api: Api;
  id: string;
}

/** Another person, signed up in a session of their own. */
async function person(newApi: () => Promise<Api>, uid: string, name: string): Promise<Person> {
  const api = await newApi();
  await api.signUp({ ...newAccount(uid, name), displayName: name });
  return { api, id: (await api.me()).id };
}

/** `other` makes a buddy link, `me` uses it, `other` accepts: they are buddies. */
async function befriend(me: Api, other: Person) {
  await me.requestBuddyByLink(await other.api.replaceBuddyLink());
  await other.api.acceptBuddy((await me.me()).id);
}

/** Three glazes of one maker, named by the test's uid. */
async function glazes(api: Api, uid: string, codes = ['A-1', 'B-1', 'C-1']) {
  const first = await api.addGlaze({ newManufacturer: { name: `Mk ${uid}`, shortId: uid.toUpperCase() }, code: codes[0], name: 'Ash' });
  const manufacturerId = first.glaze.manufacturer.id;
  const rest = [];
  for (const code of codes.slice(1)) rest.push(await api.addGlaze({ manufacturerId, code, name: `Glaze ${code}` }));
  const all = [first, ...rest];
  return { ids: all.map((glaze) => glaze.id), label: (index: number) => `Mk ${uid} ${codes[index]}` };
}

const withCoats = (glazeId: string) => ({ glazeId, coats: 1 });
const personal = (glazeId: string, quantityG = 400) => ({ glazeId, ownerType: 'personal', quantityG }) as const;

test('a glaze a buddy has is marked beside "Not on your shelf", and what no buddy has is not', async ({ page, shell, api, newApi, signedIn, uid }) => {
  const g = await glazes(api, uid);
  const ada = await person(newApi, uid, 'Ada');
  const cy = await person(newApi, uid, 'Cy');
  const pat = await person(newApi, uid, 'Pat');
  await befriend(api, ada);
  // Pat asked and was never accepted; Cy has no relation at all: neither is ever shown.
  await pat.api.requestBuddyByLink(await api.replaceBuddyLink());
  await api.addStock(personal(g.ids[0]));
  await ada.api.addStock(personal(g.ids[1]));
  await cy.api.addStock(personal(g.ids[2]));
  await pat.api.addStock(personal(g.ids[2]));
  const id = await api.addCombination({
    title: `Trio ${uid}`,
    steps: [BISQUE_STEP, ...g.ids.map((glazeId) => ({ glazeId, coats: 2 }))],
  });

  await shell.open(`#/combinations/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const body = main(page);
  await expect(body.getByRole('heading', { level: 1, name: `Trio ${uid}` })).toBeVisible();
  await expect(body.getByText(t('combination.shelf.some', { have: 1, total: 3 }), { exact: true })).toBeVisible();
  await expect(body.getByText(t('combination.shelf.on'), { exact: true })).toHaveCount(1);
  await expect(body.getByText(t('combination.shelf.off'), { exact: true })).toHaveCount(2);
  // The buddy mark is text beside its own diamond, next to "Not on your shelf"; the summary line says what buddies have.
  await expect(body.getByText(t('buddies.shelf.atNames', { names: t('buddies.shelf.atName', { name: 'Ada' }) }), { exact: true })).toHaveCount(1);
  await expect(body.getByText(t('buddies.shelf.restSome', { groups: t('buddies.shelf.group', { count: 1, names: 'Ada', glazes: g.label(1) }) }))).toBeVisible();
  await expect(body.getByRole('button', { name: t('buddies.shelf.askFor', { name: 'Ada', glaze: g.label(1) }) })).toBeVisible();
  // Nobody has the third glaze for Ana: Cy and Pat are no buddies.
  await expect(body.getByRole('button', { name: startsWith('Ask ') })).toHaveCount(1);
  await expect(body.getByText(/^\s*At /)).toHaveCount(1);
  // The body only: the head holds the content-hashed script name, which may contain any two letters by chance.
  const markup = await page.locator('body').innerHTML();
  expect(markup).not.toContain('Pat');
  expect(markup).not.toContain('Cy');
});

test('a guest and an account without buddies see no buddy marks', async ({ page, shell, api, signedIn, uid }) => {
  const g = await glazes(api, uid);
  await api.addStock(personal(g.ids[0]));
  const id = await api.addCombination({ title: `Pair ${uid}`, steps: [g.ids[0], g.ids[1]].map(withCoats) });
  await shell.open(`#/combinations/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  await expect(main(page).getByText(t('combination.shelf.off'), { exact: true })).toHaveCount(1);
  await expect(main(page).getByText(/^\s*At /)).toHaveCount(0);
  await expect(main(page).getByText(startsWith(t('buddies.shelf.restAll', { groups: '' })))).toHaveCount(0);
  // Signed out, the same page has no shelf marks at all.
  await page.context().clearCookies();
  await page.goto('about:blank');
  await shell.open(`#/combinations/${id}`);
  await shell.expectGuest();
  await expect(main(page).getByText(t('combination.shelf.off'), { exact: true })).toHaveCount(0);
  await expect(main(page).getByText(/^\s*At /)).toHaveCount(0);
});

test('several buddies are named, and more than three are counted with their names in the details', async ({ page, shell, api, newApi, uid, signedIn }) => {
  const g = await glazes(api, uid, ['A-1', 'B-1', 'D-1']);
  const people = [];
  for (const name of ['Ada', 'Ben', 'Dee', 'Eli']) {
    const buddy = await person(newApi, uid, name);
    await befriend(api, buddy);
    people.push(buddy);
  }
  await api.addStock(personal(g.ids[0]));
  // Ada and Ben have B-1; all four have D-1.
  for (const buddy of people.slice(0, 2)) await buddy.api.addStock(personal(g.ids[1]));
  for (const buddy of people) await buddy.api.addStock(personal(g.ids[2]));
  const id = await api.addCombination({ title: `Quad ${uid}`, steps: g.ids.map(withCoats) });

  await shell.open(`#/combinations/${id}`);
  const body = main(page);
  await expect(body.getByText(t('buddies.shelf.atNames', { names: "Ada's and Ben's" }), { exact: true })).toBeVisible();
  await expect(body.getByRole('button', { name: t('buddies.shelf.askFor', { name: 'Ben', glaze: g.label(1) }) })).toBeVisible();
  // Four buddies: the mark says how many and the names are in its details, each with its own Ask.
  const summary = body.getByText(t('buddies.shelf.atCount', { count: 4 }), { exact: true });
  await expect(summary).toBeVisible();
  await expect(body.getByRole('button', { name: t('buddies.shelf.askFor', { name: 'Eli', glaze: g.label(2) }) })).toBeHidden();
  await summary.click();
  for (const name of ['Ada', 'Ben', 'Dee', 'Eli'])
    await expect(body.getByRole('button', { name: t('buddies.shelf.askFor', { name, glaze: g.label(2) }) })).toBeVisible();
  // The summary line names each group by who has what: Ada and Ben have B-1; the four have D-1 (two names and "2 more"... never a bare count).
  await expect(
    body.getByText(
      t('buddies.shelf.restAll', {
        groups: [
          t('buddies.shelf.group', { count: 2, names: 'Ada and Ben', glazes: g.label(1) }),
          t('buddies.shelf.group', { count: 4, names: t('buddies.shelf.namesMore', { names: 'Ada, Ben', count: 2 }), glazes: g.label(2) }),
        ].join('; '),
      }),
      { exact: true },
    ),
  ).toBeVisible();
});

test('Ask Ada copies the message with a link to a published combination and names a draft by its title alone', async ({
  page,
  shell,
  api,
  newApi,
  uid,
  context,
  signedIn,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const g = await glazes(api, uid, ['A-1', 'B-1']);
  const ada = await person(newApi, uid, 'Ada');
  await befriend(api, ada);
  await api.addStock(personal(g.ids[0]));
  await ada.api.addStock(personal(g.ids[1]));
  const published = await api.addCombination({ title: `Celadon ${uid}`, steps: g.ids.map(withCoats) });
  const draft = await api.addCombination({ title: `Secret ${uid}`, draft: true, steps: g.ids.map(withCoats) });
  const ask = page.getByRole('button', { name: t('buddies.shelf.askFor', { name: 'Ada', glaze: g.label(1) }) });

  await shell.open(`#/combinations/${published}`);
  await ask.click();
  await expect(page.getByText(t('notices.messageCopied'))).toBeVisible();
  const origin = new URL(page.url()).origin;
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    `Hi Ada, could I borrow some ${g.label(1)} for Celadon ${uid}? ${origin}/#/combinations/${published}`,
  );

  // A draft exists only for its author: Ada could not open the link, so the message carries the title alone.
  await shell.open(`#/combinations/${draft}`);
  await ask.click();
  await expect(page.getByText(t('notices.messageCopied'))).toBeVisible();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toBe(`Hi Ada, could I borrow some ${g.label(1)} for Secret ${uid}?`);
  expect(text).not.toContain('http');
});

test('Ask Ada opens the system share sheet with the message alone, and a refused sheet falls back to a copy', async ({
  page,
  shell,
  api,
  newApi,
  uid,
  context,
  signedIn,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const g = await glazes(api, uid, ['A-1', 'B-1']);
  const ada = await person(newApi, uid, 'Ada');
  await befriend(api, ada);
  await api.addStock(personal(g.ids[0]));
  await ada.api.addStock(personal(g.ids[1]));
  const id = await api.addCombination({ title: `Celadon ${uid}`, steps: g.ids.map(withCoats) });
  await page.addInitScript(() => {
    const target = window as unknown as { shared: unknown[]; failShare: boolean };
    target.shared = [];
    target.failShare = false;
    navigator.share = (data) => {
      if (target.failShare) return Promise.reject(new Error('refused'));
      target.shared.push(data);
      return Promise.resolve();
    };
  });
  await shell.open(`#/combinations/${id}`);
  const ask = page.getByRole('button', { name: t('buddies.shelf.askFor', { name: 'Ada', glaze: g.label(1) }) });
  const origin = new URL(page.url()).origin;
  const message = `Hi Ada, could I borrow some ${g.label(1)} for Celadon ${uid}? ${origin}/#/combinations/${id}`;
  await ask.click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { shared: unknown[] }).shared)).toEqual([{ text: message }]);
  await expect(page.getByText(t('notices.messageCopied'))).toHaveCount(0);
  await page.evaluate(() => ((window as unknown as { failShare: boolean }).failShare = true));
  await ask.click();
  await expect(page.getByText(t('notices.messageCopied'))).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(message);
});

test('Ask Ada offers the message to copy by hand when neither sharing nor copying is allowed', async ({ page, shell, api, newApi, uid, signedIn }) => {
  const g = await glazes(api, uid, ['A-1', 'B-1']);
  const ada = await person(newApi, uid, 'Ada');
  await befriend(api, ada);
  await api.addStock(personal(g.ids[0]));
  await ada.api.addStock(personal(g.ids[1]));
  const id = await api.addCombination({ title: `Celadon ${uid}`, steps: g.ids.map(withCoats) });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) } });
  });
  await shell.open(`#/combinations/${id}`);
  const ask = page.getByRole('button', { name: t('buddies.shelf.askFor', { name: 'Ada', glaze: g.label(1) }) });
  await ask.click();
  const dialog = page.getByRole('dialog', { name: t('buddies.shelf.manualTitle') });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: t('buddies.shelf.manualLabel', { name: 'Ada' }) })).toHaveValue(
    new RegExp(`^Hi Ada, could I borrow some ${g.label(1)} for Celadon ${uid}\\? http`),
  );
  await dialog
    .getByRole('button', { name: t('common.close') })
    .first()
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(ask).toBeFocused();
});

test('Keep private hides a personal entry from buddies and is offered on personal rows only', async ({ page, shell, api, newApi, uid, signedIn }) => {
  const g = await glazes(api, uid, ['A-1', 'B-1']);
  const ada = await person(newApi, uid, 'Ada');
  await befriend(api, ada);
  await api.addStock(personal(g.ids[0]));
  const club = await api.createClub(`Club ${uid}`);
  await api.addStock({ glazeId: g.ids[1], ownerType: 'club', clubId: club.id, quantityG: 300 });
  const seen = async () => (await ada.api.buddyAvailability()).map((entry) => entry.glazeId);
  expect(await seen()).toEqual([g.ids[0]]);

  await shell.open('#/stock');
  await shell.expectSignedIn(signedIn.displayName);
  const keep = page.getByRole('checkbox', { name: startsWith(t('stock.row.keepPrivate')) });
  // One switch: the club entry never gets one.
  await expect(keep).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 3, name: startsWith('Club') })).toBeVisible();
  await expect(keep).not.toBeChecked();
  await expect(main(page).getByText(t('stock.row.keepPrivateHint'))).toHaveCount(1);

  await keep.check();
  await expect(page.getByText(t('notices.keepPrivateOn'))).toBeVisible();
  await expect.poll(seen).toEqual([]);
  expect((await api.stock()).find((entry) => entry.glazeId === g.ids[0])?.keepPrivate).toBe(true);
  // It is the saved state, not a local one.
  await shell.open('#/stock');
  await expect(keep).toBeChecked();
  await keep.uncheck();
  await expect(page.getByText(t('notices.keepPrivateOff'))).toBeVisible();
  await expect.poll(seen).toEqual([g.ids[0]]);
  await expect(keep).not.toBeChecked();
});

test('Include buddies counts what buddies have for I can make now, off by default and remembered on the device', async ({
  page,
  shell,
  api,
  newApi,
  uid,
  signedIn,
}) => {
  const g = await glazes(api, uid);
  const ada = await person(newApi, uid, 'Ada');
  await befriend(api, ada);
  const cy = await person(newApi, uid, 'Cy');
  await api.addStock(personal(g.ids[0]));
  await ada.api.addStock(personal(g.ids[1]));
  await cy.api.addStock(personal(g.ids[2]));
  await api.addCombination({ title: `Pair ${uid}`, steps: [g.ids[0], g.ids[1]].map(withCoats) });
  await api.addCombination({ title: `Far ${uid}`, steps: [g.ids[0], g.ids[2]].map(withCoats) });
  const me = (await api.me()).id;
  const key = `glazelab:include-buddies:${me}`;
  const stored = () => page.evaluate((name) => localStorage.getItem(name), key);

  await shell.open('#/?type=combinations&quick=canMake');
  await shell.expectSignedIn(signedIn.displayName);
  const include = main(page).getByRole('checkbox', { name: startsWith(t('discover.buddies.include')) });
  await expect(include).toBeVisible();
  await expect(include).not.toBeChecked();
  expect(await stored()).toBeNull();
  await expect(main(page).getByRole('heading', { level: 3 })).toHaveCount(0);

  await include.check();
  const card = main(page)
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: `Pair ${uid}` }) });
  await expect(card).toBeVisible();
  // The card says who has what; the combination a non-buddy could make stays out.
  await expect(
    card.getByText(t('buddies.shelf.restAll', { groups: t('buddies.shelf.group', { count: 1, names: 'Ada', glazes: g.label(1) }) }), { exact: true }),
  ).toBeVisible();
  await expect(main(page).getByRole('heading', { name: `Far ${uid}` })).toHaveCount(0);
  await expect(main(page).getByText(t('discover.buddies.counted', { names: 'Ada' }), { exact: false })).toBeVisible();
  expect(await stored()).toBe('1');

  // Remembered per device: a new load still has it on.
  await page.goto('about:blank');
  await shell.open('#/?type=combinations&quick=canMake');
  await expect(include).toBeChecked();
  await expect(card).toBeVisible();
  await include.uncheck();
  await expect(main(page).getByRole('heading', { name: `Pair ${uid}` })).toHaveCount(0);
  expect(await stored()).toBeNull();
});

test('the Include buddies switch is not offered to an account without buddies', async ({ page, shell, api, signedIn, uid }) => {
  const g = await glazes(api, uid, ['A-1', 'B-1']);
  await api.addStock(personal(g.ids[0]));
  await api.addCombination({ title: `Pair ${uid}`, steps: g.ids.map(withCoats) });
  await shell.open('#/?type=combinations&quick=canMake');
  await shell.expectSignedIn(signedIn.displayName);
  await expect(main(page).getByRole('link', { name: startsWith(t('discover.quick.canMake')) })).toBeVisible();
  await expect(main(page).getByRole('checkbox', { name: startsWith(t('discover.buddies.include')) })).toHaveCount(0);
});

test('the glaze page names the buddies who have the glaze, never amounts', async ({ page, shell, api, newApi, uid, signedIn }) => {
  const g = await glazes(api, uid, ['A-1', 'B-1']);
  const ada = await person(newApi, uid, 'Ada');
  const ben = await person(newApi, uid, 'Ben');
  await befriend(api, ada);
  await befriend(api, ben);
  await ada.api.addStock(personal(g.ids[1], 123));
  await ben.api.addStock(personal(g.ids[1], 456));
  await api.addStock(personal(g.ids[0]));

  await shell.open(`#/glazes/${g.ids[1]}`);
  await shell.expectSignedIn(signedIn.displayName);
  await expect(main(page).getByText(t('buddies.shelf.glazeHolders', { names: 'Ada and Ben' }), { exact: true })).toBeVisible();
  expect(await main(page).innerText()).not.toMatch(/123|456/);
  // A glaze nobody has shows no line.
  await shell.open(`#/glazes/${g.ids[0]}`);
  await expect(main(page).getByText(startsWith(t('buddies.shelf.glazeHolders', { names: '' })))).toHaveCount(0);
});

test('the glaze page asks a buddy with a plain message naming the glaze only, with no link', async ({ page, shell, api, newApi, uid, context, signedIn }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const g = await glazes(api, uid, ['A-1', 'B-1']);
  const ada = await person(newApi, uid, 'Ada');
  const ben = await person(newApi, uid, 'Ben');
  const stranger = await person(newApi, uid, 'Zed');
  await befriend(api, ada);
  await befriend(api, ben);
  await ada.api.addStock(personal(g.ids[1]));
  await stranger.api.addStock(personal(g.ids[1]));
  await page.addInitScript(() => {
    const target = window as unknown as { shared: unknown[] };
    target.shared = [];
    navigator.share = (data) => {
      target.shared.push(data);
      return Promise.resolve();
    };
  });
  const title = `${g.label(1)} Glaze B-1`;
  await shell.open(`#/glazes/${g.ids[1]}`);
  await shell.expectSignedIn(signedIn.displayName);
  const body = main(page);
  await expect(body.getByRole('button', { name: t('buddies.shelf.askFor', { name: 'Ada', glaze: title }) })).toBeVisible();
  // Only an accepted buddy who has the glaze is offered: Ben has none, Zed is no buddy.
  await expect(body.getByRole('button', { name: startsWith(t('buddies.shelf.ask', { name: 'Ben' })) })).toHaveCount(0);
  await expect(body.getByRole('button', { name: startsWith(t('buddies.shelf.ask', { name: 'Zed' })) })).toHaveCount(0);
  await body.getByRole('button', { name: t('buddies.shelf.askFor', { name: 'Ada', glaze: title }) }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { shared: unknown[] }).shared))
    .toEqual([{ text: `Hi Ada, could I borrow some ${title}?` }]);

  // Without a share sheet the same plain text is copied.
  await page.evaluate(() => Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }));
  await body.getByRole('button', { name: t('buddies.shelf.askFor', { name: 'Ada', glaze: title }) }).click();
  await expect(page.getByText(t('notices.messageCopied'))).toBeVisible();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toBe(`Hi Ada, could I borrow some ${title}?`);
  expect(text).not.toContain('http');
});

test('the glaze page puts the asks of more than three buddies in a details', async ({ page, shell, api, newApi, uid, signedIn }) => {
  const g = await glazes(api, uid, ['A-1', 'B-1']);
  for (const name of ['Ada', 'Ben', 'Dee', 'Eli']) {
    const buddy = await person(newApi, uid, name);
    await befriend(api, buddy);
    await buddy.api.addStock(personal(g.ids[1]));
  }
  await shell.open(`#/glazes/${g.ids[1]}`);
  await shell.expectSignedIn(signedIn.displayName);
  const body = main(page);
  const eli = body.getByRole('button', { name: t('buddies.shelf.askFor', { name: 'Eli', glaze: `${g.label(1)} Glaze B-1` }) });
  await expect(eli).toBeHidden();
  await body.getByText(t('buddies.shelf.askGlazeMany'), { exact: true }).click();
  await expect(eli).toBeVisible();
  await expect(body.getByRole('button', { name: startsWith(t('buddies.shelf.ask', { name: '' }).trim()) })).toHaveCount(4);
});

test('a guest sees no ask on the glaze page', async ({ page, shell, api, newApi, uid, signedIn }) => {
  const g = await glazes(api, uid, ['A-1', 'B-1']);
  const ada = await person(newApi, uid, 'Ada');
  await befriend(api, ada);
  await ada.api.addStock(personal(g.ids[1]));
  await shell.open(`#/glazes/${g.ids[1]}`);
  await expect(main(page).getByRole('button', { name: startsWith(t('buddies.shelf.ask', { name: 'Ada' })) })).toBeVisible();
  await page.context().clearCookies();
  await page.goto('about:blank');
  await shell.open(`#/glazes/${g.ids[1]}`);
  await shell.expectGuest();
  await expect(main(page).getByRole('button', { name: startsWith(t('buddies.shelf.ask', { name: 'Ada' })) })).toHaveCount(0);
});

test('a buddy removed on the account page stops showing at once', async ({ page, shell, api, newApi, uid, signedIn }) => {
  const g = await glazes(api, uid, ['A-1', 'B-1']);
  const ada = await person(newApi, uid, 'Ada');
  await befriend(api, ada);
  await api.addStock(personal(g.ids[0]));
  await ada.api.addStock(personal(g.ids[1]));
  const id = await api.addCombination({ title: `Pair ${uid}`, steps: g.ids.map(withCoats) });

  await shell.open(`#/combinations/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const mark = main(page).getByText(t('buddies.shelf.atNames', { names: t('buddies.shelf.atName', { name: 'Ada' }) }), { exact: true });
  await expect(mark).toBeVisible();
  await shell.openAccountPage(signedIn.displayName);
  await page.getByRole('button', { name: t('buddies.remove.label', { name: 'Ada' }) }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: t('buddies.remove.confirm') })
    .click();
  await expect(page.getByText(t('notices.buddyRemoved', { name: 'Ada' }))).toBeVisible();
  await shell.open(`#/combinations/${id}`);
  await expect(main(page).getByText(t('combination.shelf.off'), { exact: true })).toBeVisible();
  await expect(mark).toHaveCount(0);
});

test('offline the marks stay, as of the last connection, and Ask still works', async ({ page, shell, api, newApi, uid, context, signedIn }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const g = await glazes(api, uid, ['A-1', 'B-1']);
  const ada = await person(newApi, uid, 'Ada');
  await befriend(api, ada);
  await api.addStock(personal(g.ids[0]));
  await ada.api.addStock(personal(g.ids[1]));
  const id = await api.addCombination({ title: `Pair ${uid}`, steps: g.ids.map(withCoats) });
  await shell.open(`#/combinations/${id}`);
  const mark = main(page).getByText(t('buddies.shelf.atNames', { names: t('buddies.shelf.atName', { name: 'Ada' }) }), { exact: true });
  await expect(mark).toBeVisible();
  const asOf = main(page).getByText(startsWith(t('buddies.shelf.asOf', { date: '' })));
  await expect(asOf).toHaveCount(0);

  await context.setOffline(true);
  await expect(asOf).toBeVisible();
  const date = new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(Date.now());
  await expect(asOf).toHaveText(t('buddies.shelf.asOf', { date }));
  await expect(mark).toBeVisible();
  await main(page)
    .getByRole('button', { name: t('buddies.shelf.askFor', { name: 'Ada', glaze: g.label(1) }) })
    .click();
  await expect(page.getByText(t('notices.messageCopied'))).toBeVisible();
  await context.setOffline(false);
  await expect(asOf).toHaveCount(0);
});
