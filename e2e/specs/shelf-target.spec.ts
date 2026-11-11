import type { Page } from '@playwright/test';
import type { Api } from '../support/api';
import { DIALOG, expectAccessible } from '../support/axe';
import { t, withCount } from '../support/i18n';
import { AddGlazeDialog } from '../support/pages/add-glaze';
import { expect, newAccount, test } from '../support/test';

// SHELF-3: the shelf a page works on is unmistakable, and every write names its target.

const main = (page: Page) => page.getByRole('main');
const header = (page: Page) => main(page).getByRole('region', { name: t('stock.scope.label') });
const chips = (page: Page) => main(page).getByRole('group', { name: t('stock.shelves.label') });
const owner = (page: Page) => main(page).getByRole('combobox', { name: t('stock.form.owner'), exact: true });
const button = (page: Page, name: string) => main(page).getByRole('button', { name, exact: true });

/** Fern on the personal shelf and on the club's, Moss on the club's only, Ash nowhere. */
async function seed(api: Api, uid: string) {
  const fern = await api.addGlaze({ newManufacturer: { name: `Target ${uid}`, shortId: uid.toUpperCase() }, code: 'F-1', name: 'Fern' });
  const manufacturerId = fern.glaze.manufacturer.id;
  const moss = await api.addGlaze({ manufacturerId, code: 'M-1', name: 'Moss' });
  const ash = await api.addGlaze({ manufacturerId, code: 'A-1', name: 'Ash' });
  const club = { id: (await api.createClub(`Kiln ${uid}`)).id, name: `Kiln ${uid}` };
  await api.addStock({ glazeId: fern.id, ownerType: 'personal', quantityG: 400 });
  await api.addStock({ glazeId: fern.id, ownerType: 'club', clubId: club.id, quantityG: 800 });
  await api.addStock({ glazeId: moss.id, ownerType: 'club', clubId: club.id, quantityG: 1200 });
  const title = (name: string, code: string) => `Target ${uid} ${code} ${name}`;
  return { fern: fern.id, moss: moss.id, ash: ash.id, club, title };
}

test('the scope header changes with the shelf chips and the form names the shelf it writes to', async ({ page, shell, api, signedIn, uid }) => {
  const { club } = await seed(api, uid);
  // Opening the app on the shelf: all shelves, and the form writes to the personal one.
  await shell.open('#/stock');
  await shell.expectSignedIn(signedIn.displayName);
  await expect(header(page)).toContainText(t('stock.scope.all'));
  await expect(chips(page).getByRole('link', { name: withCount(t('stock.shelves.all')) })).toHaveAttribute('aria-current', 'page');
  await expect(owner(page)).toHaveValue('personal');
  await expect(button(page, t('stock.target.add'))).toBeVisible();

  await chips(page)
    .getByRole('link', { name: withCount(club.name) })
    .click();
  await expect(header(page)).toContainText(t('stock.scope.club'));
  await expect(header(page)).toContainText(club.name);
  await expect(header(page)).toContainText(t('stock.scope.clubHint'));
  await expect(chips(page).getByRole('link', { name: withCount(club.name) })).toHaveAttribute('aria-current', 'page');
  await expect(owner(page)).toHaveValue(club.id);
  await expect(button(page, t('stock.target.addClub', { club: club.name }))).toBeVisible();
  // The select's sentence says whose stock this is, tied to it for assistive technology.
  await expect(owner(page)).toHaveAccessibleDescription(new RegExp(t('stock.scope.clubHint').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  await expectAccessible(page);

  await chips(page)
    .getByRole('link', { name: withCount(t('stock.owner.me')) })
    .click();
  await expect(header(page)).toContainText(t('stock.scope.personal'));
  await expect(header(page)).not.toContainText(club.name);
  await expect(owner(page)).toHaveValue('personal');
  await expect(button(page, t('stock.target.add'))).toBeVisible();

  // Back to all shelves from a club: the form goes back to the personal shelf, never the club left on the chip.
  await chips(page)
    .getByRole('link', { name: withCount(club.name) })
    .click();
  await expect(owner(page)).toHaveValue(club.id);
  await chips(page)
    .getByRole('link', { name: withCount(t('stock.shelves.all')) })
    .click();
  await expect(header(page)).toContainText(t('stock.scope.all'));
  await expect(owner(page)).toHaveValue('personal');
});

test('the form, the row editor and the glaze page name the club before they write to it', async ({ page, shell, api, signedIn, uid }) => {
  const { fern, moss, ash, club, title } = await seed(api, uid);
  await shell.open(`#/stock?shelf=${club.id}&glaze=${fern}`);
  await shell.expectSignedIn(signedIn.displayName);
  // An entry the club already has: the button updates the club's shelf.
  await expect(button(page, t('stock.target.updateClub', { club: club.name }))).toBeVisible();
  await owner(page).selectOption('personal');
  await expect(button(page, t('stock.target.update'))).toBeVisible();

  // The amount editor of a club row names the club.
  await main(page)
    .getByRole('button', { name: t('stock.row.editAmount', { amount: '1,200 g', glaze: title('Moss', 'M-1') }) })
    .click();
  await expect(main(page).getByLabel(t('stock.row.amountLabelClub', { glaze: title('Moss', 'M-1'), club: club.name }))).toBeFocused();
  await page.keyboard.press('Escape');

  // Glaze page: the one-click add goes to the personal shelf and says so; the add form names a chosen club.
  await shell.open(`#/glazes/${ash}`);
  const quick = button(page, t('glaze.shelf.quickAddFor', { size: 250, glaze: title('Ash', 'A-1') }));
  await expect(quick).toHaveText(t('glaze.shelf.quickAdd'));
  await main(page)
    .getByRole('button', { name: t('glaze.shelf.addFor', { glaze: title('Ash', 'A-1') }) })
    .click();
  await expect(owner(page)).toHaveValue('personal');
  await expect(button(page, t('stock.target.add'))).toBeVisible();
  await owner(page).selectOption(club.id);
  await expect(button(page, t('stock.target.addClub', { club: club.name }))).toBeVisible();
  await expectAccessible(page);
  await button(page, t('stock.target.addClub', { club: club.name })).click();
  await expect.poll(async () => (await api.stock()).filter((entry) => entry.glazeId === ash).map((entry) => entry.clubId)).toEqual([club.id]);

  // The glaze the club holds but the account does not: its one-click add on the glaze page still goes to the personal shelf.
  await shell.open(`#/glazes/${moss}`);
  await button(page, t('glaze.shelf.quickAddFor', { size: 250, glaze: title('Moss', 'M-1') })).click();
  await expect
    .poll(async () =>
      (await api.stock())
        .filter((entry) => entry.glazeId === moss)
        .map((entry) => entry.clubId ?? 'personal')
        .sort(),
    )
    .toEqual([club.id, 'personal'].sort());
});

test('an Explore row adds to the personal shelf, even right after a club shelf was shown', async ({ page, shell, api, signedIn, uid }) => {
  const { ash, club, title } = await seed(api, uid);
  await shell.open(`#/stock?shelf=${club.id}`);
  await shell.expectSignedIn(signedIn.displayName);
  await expect(header(page)).toContainText(club.name);
  await shell.open(`#/?type=glazes&q=${uid}`);
  const quick = main(page).getByRole('button', { name: t('glaze.shelf.quickAddFor', { size: 250, glaze: title('Ash', 'A-1') }) });
  await quick.click();
  await expect.poll(async () => (await api.stock()).filter((entry) => entry.glazeId === ash).map((entry) => entry.clubId)).toEqual([null]);
});

test('a club left or another account never stays the shelf a form writes to', async ({ page, shell, api, newApi, signedIn, uid }) => {
  const other = await newApi();
  const pat = newAccount(uid, 'Pat');
  await other.signUp({ ...pat, displayName: 'Pat' });
  const { club: patClub, token } = await other.clubWithInvite(`Pat club ${uid}`);
  await api.joinClub(token);
  const { club } = await seed(api, uid);
  await shell.open(`#/stock?shelf=${patClub.id}`);
  await shell.expectSignedIn(signedIn.displayName);
  await expect(owner(page)).toHaveValue(patClub.id);
  await expect(header(page)).toContainText(`Pat club ${uid}`);

  // Removed from the club: the same link shows all shelves and the form writes to the personal shelf.
  await other.removeMember(patClub.id, (await api.me()).id);
  await page.reload();
  await shell.expectSignedIn(signedIn.displayName);
  await expect(header(page)).toContainText(t('stock.scope.all'));
  await expect(owner(page)).toHaveValue('personal');

  // Another account signs in on the device with a club link of the first: its own personal shelf.
  await page.goto(`/#/stock?shelf=${club.id}`);
  await expect(header(page)).toContainText(club.name);
  await api.signIn(pat);
  await page.reload();
  await shell.expectSignedIn('Pat');
  await expect(header(page)).toContainText(t('stock.scope.all'));
  await expect(header(page)).not.toContainText(club.name);
  await expect(owner(page)).toHaveValue('personal');
  await expect(button(page, t('stock.target.add'))).toBeVisible();
});

test('the scan sheet names the club it saves to', async ({ page, shell, api, signedIn, uid, isMobile }) => {
  test.skip(!isMobile, 'the scan session is the phone layout');
  const { club } = await seed(api, uid);
  await shell.open(`#/stock?shelf=${club.id}`);
  await shell.expectSignedIn(signedIn.displayName);
  // The link names the club only once the clubs are loaded; a scan started before that begins on the personal shelf.
  await expect(header(page)).toContainText(club.name);
  await page.getByRole('button', { name: t('stock.scan.button') }).click();
  await expect(page.getByRole('dialog', { name: t('stock.scan.titleClub', { club: club.name }) })).toBeVisible();
  await expectAccessible(page, { include: [DIALOG] });
  await page.keyboard.press('Escape');
  await shell.open('#/stock?shelf=personal');
  await page.getByRole('button', { name: t('stock.scan.button') }).click();
  await expect(page.getByRole('dialog', { name: t('stock.scan.title') })).toBeVisible();
});

/** A background load of the account's data (as after the device comes online again), which replaces the clubs listing. */
async function refreshData(page: Page) {
  const membersRead = page.waitForResponse((response) => /^\/api\/clubs\/[^/]+\/members$/.test(new URL(response.url()).pathname));
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await membersRead;
  // The load applies its answers right after the member lists; two frames later they are rendered.
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}

test('a background refresh keeps the shelf the person chose in the form', async ({ page, shell, api, signedIn, uid }) => {
  const { club } = await seed(api, uid);
  await shell.open('#/stock');
  await shell.expectSignedIn(signedIn.displayName);
  // All shelves; no glaze chosen yet, the club chosen in the form on purpose.
  await owner(page).selectOption(club.id);
  await expect(button(page, t('stock.target.addClub', { club: club.name }))).toBeVisible();
  await refreshData(page);
  // Same clubs, a new listing: neither the choice nor the button changes behind the person's back.
  await expect(owner(page)).toHaveValue(club.id);
  await expect(button(page, t('stock.target.addClub', { club: club.name }))).toBeVisible();
  // A chip change still sets it.
  await chips(page)
    .getByRole('link', { name: withCount(t('stock.owner.me')) })
    .click();
  await expect(owner(page)).toHaveValue('personal');
});

test('the glaze page add form never moves to another club when its club goes away', async ({ page, shell, api, newApi, signedIn, uid }) => {
  const other = await newApi();
  await other.signUp({ ...newAccount(uid, 'Pat'), displayName: 'Pat' });
  const firstName = `A Pat ${uid}`;
  const { club: first, token } = await other.clubWithInvite(firstName);
  await api.joinClub(token);
  const second = `B Kiln ${uid}`;
  await api.createClub(second);
  const { ash, title } = await seed(api, uid);
  await api.addStock({ glazeId: ash, ownerType: 'personal', quantityG: 300 });
  await shell.open(`#/glazes/${ash}`);
  await shell.expectSignedIn(signedIn.displayName);
  await main(page)
    .getByRole('button', { name: t('glaze.shelf.updateFor', { glaze: title('Ash', 'A-1') }) })
    .click();
  await main(page)
    .getByRole('button', { name: t('glaze.shelf.addAnother') })
    .click();
  await expect(owner(page)).toHaveValue(first.id);
  await expect(button(page, t('stock.target.addClub', { club: firstName }))).toBeVisible();
  // Removed from the chosen club meanwhile: the form must not quietly write to the next club instead.
  await other.removeMember(first.id, (await api.me()).id);
  await refreshData(page);
  await expect(main(page).getByRole('button', { name: new RegExp(second) })).toHaveCount(0);
  // Nothing else is free (the personal shelf holds it): the form closes rather than pick a club nobody chose.
  await expect(owner(page)).toHaveCount(0);
});

test('removed from the club while its glaze is chosen in the form: the form goes to the personal shelf at once', async ({
  page,
  shell,
  api,
  newApi,
  signedIn,
  uid,
}) => {
  const other = await newApi();
  await other.signUp({ ...newAccount(uid, 'Pat'), displayName: 'Pat' });
  const patName = `Pat club ${uid}`;
  const { club: patClub, token } = await other.clubWithInvite(patName);
  await api.joinClub(token);
  const { ash } = await seed(api, uid);
  await shell.open(`#/stock?shelf=${patClub.id}&glaze=${ash}`);
  await shell.expectSignedIn(signedIn.displayName);
  await expect(button(page, t('stock.target.addClub', { club: patName }))).toBeVisible();
  await other.removeMember(patClub.id, (await api.me()).id);
  await refreshData(page);
  await expect(owner(page)).toHaveValue('personal');
  await expect(button(page, t('stock.target.add'))).toBeVisible();
  await expect(header(page)).toContainText(t('stock.scope.all'));
});

test('a long club name stays inside its shelf chip on a 320 px phone, with its count', async ({ page, shell, api, signedIn, uid, isMobile }) => {
  test.skip(!isMobile, 'the chips scroll on one line on phones');
  const name = `Keramikwerkstatt Sonnenberg am Rhein ${uid}`;
  const club = (await api.createClub(name)).id;
  await page.setViewportSize({ width: 320, height: 800 });
  await shell.open(`#/stock?shelf=${club}`);
  await shell.expectSignedIn(signedIn.displayName);
  const chip = chips(page).getByRole('link', { name: withCount(name) });
  await expect(chip).toHaveAttribute('aria-current', 'page');
  // Every part of the chip (its name and its count) lies within the chip's own pill.
  const overflow = await chip.evaluate((link) => {
    const box = link.getBoundingClientRect();
    return [...link.children].map((part) => {
      const inner = part.getBoundingClientRect();
      return Math.round(Math.max(box.left - inner.left, inner.right - box.right));
    });
  });
  expect(
    overflow.every((pixels) => pixels <= 0),
    `parts overflow the chip by ${overflow.join(', ')} px`,
  ).toBe(true);
  // A name cut short is clipped to its box and ends in an ellipsis, never painted over the next chip.
  const cut = await chip.evaluate((link) =>
    [...link.children]
      .filter((part) => part.scrollWidth > part.clientWidth)
      .map((part) => `${getComputedStyle(part).overflowX} ${getComputedStyle(part).textOverflow}`),
  );
  expect(cut).toEqual(['hidden ellipsis']);
});

test('choosing a club in the shelf select by keyboard keeps focus on the select and shows the club callout', async ({ page, shell, api, signedIn, uid }) => {
  const { club } = await seed(api, uid);
  await shell.open('#/stock?shelf=personal');
  await shell.expectSignedIn(signedIn.displayName);
  await owner(page).focus();
  await page.keyboard.press('ArrowDown');
  await expect(owner(page)).toHaveValue(club.id);
  await expect(owner(page)).toBeFocused();
  await expect(owner(page)).toHaveAccessibleDescription(new RegExp(t('stock.scope.club')));
});

test('typed shelf input asks before leaving the stock page and the glaze page; Stay keeps it', async ({ page, shell, api, signedIn, uid, isMobile }) => {
  const { ash, title } = await seed(api, uid);
  const question = page.getByRole('dialog', { name: t('drafts.discardShelfScan') });
  const leave = () =>
    page
      .getByRole('navigation', { name: t('nav.label') })
      .getByRole('link', { name: t('nav.explore') })
      .first()
      .click();
  const amount = main(page).getByRole('spinbutton', { name: t('stock.form.quantity') });
  if (!isMobile) {
    await shell.open(`#/stock?glaze=${ash}`);
    await shell.expectSignedIn(signedIn.displayName);
    await amount.fill('321');
    await leave();
    await question.getByRole('button', { name: t('drafts.stay') }).click();
    await expect(page).toHaveURL(new RegExp(`#/stock\\?glaze=${ash}$`));
    await expect(amount).toHaveValue('321');
    await leave();
    await question.getByRole('button', { name: t('drafts.discard') }).click();
    await expect(page).toHaveURL(/#\/$/);
  }
  await shell.open(`#/glazes/${ash}`);
  await shell.expectSignedIn(signedIn.displayName);
  await main(page)
    .getByRole('button', { name: t('glaze.shelf.addFor', { glaze: title('Ash', 'A-1') }) })
    .click();
  // The default amount alone is nothing to lose.
  await leave();
  await expect(page).toHaveURL(/#\/$/);
  await expect(question).toHaveCount(0);
  await page.goBack();
  await main(page)
    .getByRole('button', { name: t('glaze.shelf.addFor', { glaze: title('Ash', 'A-1') }) })
    .click();
  await amount.fill('321');
  await leave();
  await question.getByRole('button', { name: t('drafts.stay') }).click();
  await expect(amount).toHaveValue('321');
});

/** Opens the add-glaze dialog of the stock form ("Add glaze" in the glaze picker). */
async function openAddGlaze(page: Page) {
  await main(page)
    .getByRole('button', { name: t('glazePicker.add') })
    .click();
  const add = new AddGlazeDialog(page);
  await expect(add.dialog).toBeVisible();
  return add;
}
const dialogOwner = (add: AddGlazeDialog) => add.dialog.getByRole('combobox', { name: t('stock.form.owner'), exact: true });

test('the add-glaze dialog of a club shelf starts on that club; closed untouched it asks nothing', async ({ page, shell, api, signedIn, uid }) => {
  const { club } = await seed(api, uid);
  await shell.open(`#/stock?shelf=${club.id}`);
  await shell.expectSignedIn(signedIn.displayName);
  const add = await openAddGlaze(page);
  await expect(dialogOwner(add)).toHaveValue(club.id);
  await expect(add.dialog).toContainText(t('stock.scope.clubHint'));
  await expect(add.field('glazeForm.shelf.quantity')).toHaveValue('250');
  // The preselected club is where the page points, not typed input.
  await add.close();
  await expect(add.dialog).toBeHidden();
  await expect(add.discardQuestion).toHaveCount(0);
});

test('the add-glaze dialog of the personal shelf and of all shelves starts on the personal shelf', async ({ page, shell, api, signedIn, uid }) => {
  const { club } = await seed(api, uid);
  for (const link of ['#/stock?shelf=personal', '#/stock']) {
    await shell.open(link);
    await shell.expectSignedIn(signedIn.displayName);
    const add = await openAddGlaze(page);
    await expect(dialogOwner(add)).toHaveValue('personal');
    await expect(add.dialog).not.toContainText(t('stock.scope.clubHint'));
    await expect(dialogOwner(add).locator('option', { hasText: club.name })).toHaveCount(1);
    await add.close();
    await expect(add.dialog).toBeHidden();
  }
});

test('the add-glaze dialog starts on the shelf chosen in the stock form', async ({ page, shell, api, signedIn, uid }) => {
  const { club } = await seed(api, uid);
  await shell.open('#/stock');
  await shell.expectSignedIn(signedIn.displayName);
  await owner(page).selectOption(club.id);
  const add = await openAddGlaze(page);
  await expect(dialogOwner(add)).toHaveValue(club.id);
});
