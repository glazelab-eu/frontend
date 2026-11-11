import type { APIRequestContext, Page } from '@playwright/test';
import { BISQUE_STEP, Api } from '../support/api';
import { DIALOG, expectAccessible } from '../support/axe';
import { startsWith, t } from '../support/i18n';
import { paintedPng, photoPng, png, pngHeaderOnly, seededPicture } from '../support/images';
import { Naming, seedLibrary, type SeededLibrary } from '../support/library';
import { MOCK_USER, mockApi } from '../support/mock-api';
import { termsVersion } from '../../src/lib/api/terms';
import { DIST } from '../support/paths';
import { AddGlazeDialog } from '../support/pages/add-glaze';
import { AccountPage } from '../support/pages/account';
import { AvatarSection } from '../support/pages/avatar';
import { grantSiteAdmin } from '../support/site-admin';
import { PasswordDialog } from '../support/pages/password';
import { StudioPage } from '../support/pages/studio';
import { expect, newAccount, test as base } from '../support/test';
import { seedSimilar } from '../support/similar';
import { standInFiles, VISION_URL } from '../support/vision';
import { startWebServer } from '../support/web-server';
import { anyLanguage, dictionaries, locales, translated } from '../support/locales';
import { SOURCE_URL } from '../support/backend';

/** The name of the stock choices under "On my shelf" in the three languages. */
const SHELF_STOCK_GROUP = anyLanguage('discover.shelfStock.label', {}, true);
/** The club and buddy options of "On my shelf" in the three languages. */
const SHELF_OPTIONS = new RegExp(`${anyLanguage('discover.shelf.clubs.include').source}|${anyLanguage('discover.buddies.include').source}`);

/**
 * axe (WCAG 2.1 A/AA and best practices, `support/axe.ts`) over the main pages and dialogs, one test per page or dialog, at phone
 * and desktop width, against the seeded library. Each test waits for the page's own content first, so axe sees the settled page.
 */
interface Library extends SeededLibrary {
  naming: Naming;
}

const test = base.extend<object, { library: Library }>({
  // Two potters with nine glazes and five combinations (the first two with photos), made once per worker; the data is public and read-only here.
  library: [
    async ({ playwright }, use, workerInfo) => {
      const baseURL = process.env.GLAZELAB_E2E_BASE_URL;
      if (!baseURL) throw new Error('GLAZELAB_E2E_BASE_URL is unset: run the suite through its config (npm run e2e)');
      const contexts: APIRequestContext[] = [];
      const newApi = async () => {
        const context = await playwright.request.newContext({ baseURL });
        contexts.push(context);
        return new Api(context);
      };
      const naming = new Naming('a' + Buffer.from(`${workerInfo.project.name}${workerInfo.workerIndex}`).toString('hex').slice(-8), false);
      const seeded = await seedLibrary(newApi, naming, 2);
      await use({ ...seeded, naming });
      await Promise.all(contexts.map((context) => context.dispose()));
    },
    { scope: 'worker', timeout: 120_000 },
  ],
});

/** A wide picture, red left and blue right, for the profile picture cases. */
const twoTonePicture = () => paintedPng('two-tone.png', 400, 200, (x) => (x < 200 ? [220, 40, 40] : [40, 40, 220]));

/** The profile-picture queue as the API answers it: four pictures in the states an admin meets (the evidence image is mocked too). */
const AVATAR_QUEUE = {
  hasMore: false,
  entries: [
    ['c1', 'a1', 'Cleo Marsh', 'OPEN', 'CURRENT', 'Shows my neighbour'],
    ['c2', 'a2', 'Dee Nolan', 'OPEN', 'REPLACED', 'Not a pot'],
    ['c3', 'a3', null, 'CLOSED', 'ACCOUNT_DELETED', null],
    ['c4', 'a4', 'Ben Okafor', 'ACTIONED', 'ADMIN_REMOVED', 'Rude'],
  ].map(([id, avatarId, owner, status, picture, reason]) => ({
    id: `00000000-0000-4000-8000-0000000000${id}`,
    avatarId: `00000000-0000-4000-8000-0000000001${String(avatarId).slice(1)}`,
    ownerId: owner ? `00000000-0000-4000-8000-0000000002${String(avatarId).slice(1)}` : null,
    owner,
    reporter: 'Mara Lindqvist',
    reason,
    createdAt: '2026-10-31T10:00:00Z',
    status,
    closedAt: status === 'OPEN' ? null : '2026-11-01T09:00:00Z',
    closedBy: status === 'OPEN' || status === 'CLOSED' ? null : 'Ana',
    picture,
    // Closed with the account: its pictures were deleted with it (34-7).
    hasPicture: status !== 'CLOSED',
  })),
};

/** The queue's pictures load as their entries come near the view: scroll through the list so every image is there when axe looks. */
async function loadQueuePictures(page: Page) {
  for (const entry of await page.locator('.avatar-reports__entry').all()) await entry.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo(0, 0));
}

/** Mocks the admin queue and answers each evidence image with a picture. */
async function mockAvatarQueue(page: Page) {
  const evidence = seededPicture('queue');
  await mockApi(page, {
    user: { ...MOCK_USER, siteAdmin: true },
    answers: {
      'GET /api/admin/avatar-reports': { json: AVATAR_QUEUE },
      ...Object.fromEntries(
        AVATAR_QUEUE.entries.map(({ id }) => [
          `GET /api/admin/avatar-reports/${id}/picture`,
          async (route: import('@playwright/test').Route) =>
            route.fulfill({ contentType: 'image/png', headers: { 'cache-control': 'no-store, private' }, body: evidence.buffer }),
        ]),
      ),
    },
  });
}

/** The bans as the API answers them: three entries, each with its date and reason only (an entry names nobody, 34-7). */
const BANS = {
  hasMore: false,
  entries: [
    ['b3', 'Posted other people’s pictures again after a warning.', '2026-10-31T12:00:00Z'],
    ['b2', 'Harassment of club members.\nSecond line of the reason.', '2026-10-31T11:00:00Z'],
    ['b1', 'Spam.', '2026-10-31T10:00:00Z'],
  ].map(([id, reason, bannedAt]) => ({ id: `00000000-0000-4000-8000-0000000003${String(id).slice(1)}`, reason, bannedAt })),
};

/** The error reports as the API answers them: three messages (a long one, a warning, a rejection), and the reports of the first. */
const FP1 = 'a'.repeat(64);
const ERROR_REPORTS = {
  hasMore: false,
  groups: [
    [
      FP1,
      'ERROR',
      'TypeError: Cannot read properties of undefined (reading "name") while rendering the glaze row for a very long glaze title that wraps',
      14,
      31,
    ],
    ['b'.repeat(64), 'WARNING', 'Failed to cache 0 photos', 3, 3],
    ['c'.repeat(64), 'UNHANDLED_REJECTION', 'NetworkError when attempting to fetch resource.', 1, 1],
  ].map(([fingerprint, kind, message, reports, occurrences]) => ({
    fingerprint,
    kind,
    message,
    reports,
    occurrences,
    firstSeen: '2026-10-30T08:00:00Z',
    lastSeen: '2026-11-01T09:30:00Z',
    builds: [
      { build: '0.1.0 (abc1234)', reports: 2 },
      { build: '0.1.0 (def5678)', reports: 1 },
    ],
    devices: [
      { browser: 'Chrome', os: 'Android', reports: 2 },
      { browser: null, os: null, reports: 1 },
    ],
    minViewportWidth: 360,
    maxViewportWidth: 1280,
  })),
};
const ERROR_OCCURRENCES = {
  hasMore: true,
  occurrences: [0, 1].map((index) => ({
    id: `00000000-0000-4000-8000-00000000004${index}`,
    receivedAt: '2026-11-01T09:30:00Z',
    occurredAt: '2026-11-01T09:29:58Z',
    occurrences: 2 + index,
    build: '0.1.0 (abc1234)',
    route: index ? null : 'glaze',
    stack: index
      ? null
      : 'TypeError: x is undefined\n    at render (https://glazelab.eu/assets/index-B1x2.js:1:2)\n    at update (https://glazelab.eu/assets/index-B1x2.js:3:4)',
    device: index
      ? {}
      : {
          browser: 'Chrome',
          browserVersion: '142.0.7444.59',
          os: 'Android',
          osVersion: '16',
          screenWidth: 412,
          screenHeight: 915,
          viewportWidth: 412,
          viewportHeight: 780,
          pixelRatio: 2.625,
          pointer: 'COARSE',
          language: 'pt-PT',
          standalone: true,
          online: true,
          connection: '4g',
          serviceWorker: 'ACTIVE',
          updatePending: false,
          reducedMotion: false,
          colorScheme: 'DARK',
          timezoneOffsetMinutes: -60,
          deviceMemoryGb: 8,
        },
  })),
};

/** A site admin's mocked answers for the error report pages. */
async function mockErrorReports(page: Page, groups: unknown = ERROR_REPORTS): Promise<void> {
  await mockApi(page, {
    user: { ...MOCK_USER, siteAdmin: true },
    answers: {
      'GET /api/admin/error-reports': { json: groups },
      'GET /api/admin/error-reports/builds': { json: { builds: ['0.1.0 (abc1234)', '0.1.0 (def5678)'] } },
      [`GET /api/admin/error-reports/${FP1}/occurrences`]: { json: ERROR_OCCURRENCES },
    },
  });
}

/** Opens the error reports page, the first message's details, and waits for them. */
async function openErrorReports(page: Page): Promise<void> {
  await page.goto('/#/admin/error-reports');
  await expect(page.getByRole('main').locator('.error-reports__entry').first()).toBeVisible();
  await settled(page);
  await expectAccessible(page);
  await page.getByRole('main').locator('.error-reports__entry').first().getByRole('button').first().click();
  await expect(page.getByRole('main').locator('.error-reports__row').first()).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('main').locator('.error-reports__row').first().getByRole('button').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expectAccessible(page, { include: [DIALOG] });
}

/** The first heading of the page, and every image on it loaded, so contrast is measured on the settled page. */
async function settled(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect.poll(() => page.evaluate(() => [...document.images].every((image) => image.complete))).toBe(true);
}

/** Ana with a buddy (Bo), a request to her (Cy), a request from her (Dee) and a buddy link; the link of Ada for the request page. */
async function withBuddies(api: Api, newApi: () => Promise<Api>, uid: string) {
  const mine = await api.replaceBuddyLink();
  const me = (await api.me()).id;
  const bo = await newApi();
  await bo.signUp(newAccount(uid, 'Bo'));
  await bo.requestBuddyByLink(mine);
  await api.acceptBuddy((await bo.me()).id);
  const cy = await newApi();
  await cy.signUp(newAccount(uid, 'Cy'));
  await cy.requestBuddyByLink(mine);
  const dee = await newApi();
  await dee.signUp(newAccount(uid, 'Dee'));
  await api.requestBuddyByLink(await dee.replaceBuddyLink());
  const ada = await newApi();
  await ada.signUp(newAccount(uid, 'Ada'));
  return { me, adasLink: await ada.replaceBuddyLink() };
}

/** Buddies with these names, each with the glaze on their personal shelf (the library's glazes are public). */
async function buddiesWith(api: Api, newApi: () => Promise<Api>, uid: string, names: string[], glaze: string) {
  for (const name of names) {
    const buddy = await newApi();
    await buddy.signUp(newAccount(uid, name));
    await api.requestBuddyByLink(await buddy.replaceBuddyLink());
    await buddy.acceptBuddy((await api.me()).id);
    await buddy.addStock({ glazeId: glaze, ownerType: 'personal', quantityG: 200 });
  }
}

/** Newest-first results can put pictureless cards above the first photo, and a card mounts its picture only near the viewport. */
const firstCardPhoto = async (page: Page) => {
  await page
    .getByRole('main')
    .getByRole('button', { name: startsWith(t('images.cover.open', { title: '' })) })
    .first()
    .scrollIntoViewIfNeeded();
  await expect(page.getByRole('main').getByRole('img').first()).toBeVisible();
};
const celadon = (library: Library) => library.combinations.get(library.naming.title('Celadon over Shino White'))!;
const glazeId = (library: Library) => library.glazes.get(library.naming.glaze('Botz', 'CE-1'))!;

test.describe('as a guest', () => {
  test('Explore welcome', async ({ page, shell, library }) => {
    expect(library.combinations.size).toBeGreaterThan(0);
    await shell.open('#/');
    await expect(page.getByRole('main').getByRole('article').first()).toBeVisible();
    await settled(page);
    await expectAccessible(page);
  });

  test('the account page asks a guest to sign in', async ({ page, shell }) => {
    await shell.open('#/account');
    await expect(page.getByRole('main').getByRole('heading', { level: 2, name: t('account.page.signIn') })).toBeVisible();
    await settled(page);
    await expectAccessible(page);
  });

  test('Explore with cards, photos and a tag chip', async ({ page, shell, library }) => {
    await shell.open(`#/?q=${library.naming.uid}&tags=cone-6`);
    await firstCardPhoto(page);
    await settled(page);
    await expectAccessible(page);
  });

  test('Explore glazes', async ({ page, shell, library }) => {
    await shell.open(`#/?type=glazes&q=${library.naming.uid}`);
    await expect(page.getByRole('main').getByRole('article').first()).toBeVisible();
    await settled(page);
    await expectAccessible(page);
  });

  test('combination page', async ({ page, shell, library }) => {
    await shell.open(`#/combinations/${celadon(library)}`);
    await expect(page.getByRole('img', { name: t('images.alt.tile', { title: library.naming.title('Celadon over Shino White') }) })).toBeVisible();
    await settled(page);
    await expectAccessible(page);
  });

  test('glaze page', async ({ page, shell, library }) => {
    await shell.open(`#/glazes/${glazeId(library)}`);
    await settled(page);
    await expectAccessible(page);
  });

  for (const [name, hash] of [
    ['Shelf', '#/stock'],
    ['Studio', '#/studio'],
    ['Clubs', '#/clubs'],
    ['a club', '#/clubs/00000000-0000-4000-8000-000000000001'],
    ['the terms', '#/terms'],
    ['the About page', '#/about'],
    ['an unknown page', '#/nowhere'],
    ['an unknown combination', '#/combinations/00000000-0000-4000-8000-000000000001'],
  ] as const) {
    test(name, async ({ page, shell }) => {
      await shell.open(hash);
      await settled(page);
      await expectAccessible(page);
    });
  }

  test('sign-in dialog', async ({ page, shell }) => {
    await shell.open();
    await shell.signInButton().click();
    await expect(page.getByRole('dialog', { name: t('auth.dialogLabel') })).toBeVisible();
    await expectAccessible(page, { include: [DIALOG] });
  });

  test('sign-up dialog', async ({ page, shell }) => {
    await shell.open();
    await shell.signInButton().click();
    const dialog = page.getByRole('dialog', { name: t('auth.dialogLabel') });
    await dialog.getByRole('button', { name: t('auth.register.switch') }).click();
    await expect(dialog.getByLabel(t('auth.name'))).toBeVisible();
    await expectAccessible(page, { include: [DIALOG] });
  });

  test('the tag filter with its suggestions open', async ({ page, shell, library, isMobile }) => {
    await shell.open(`#/?q=${library.naming.uid}`);
    if (isMobile) await page.getByRole('button', { name: t('discover.filters.open', { count: 1 }) }).click();
    await page.getByRole('combobox', { name: t('discover.filter.tags') }).fill('cone');
    await expect(page.getByRole('listbox').getByRole('option').first()).toBeVisible();
    await expectAccessible(page, isMobile ? { include: [DIALOG] } : {});
  });

  for (const [name, route] of [
    ['an email verification link', 'verify'],
    ['a password reset link', 'reset'],
    ['a sign-in link', 'login'],
  ] as const) {
    test(name, async ({ page, shell }) => {
      await shell.open(`#/${route}/not-a-real-token`);
      await expect(page.getByRole('dialog')).toBeVisible();
      await expectAccessible(page, { include: [DIALOG] });
    });
  }

  test('the activation of a pending account, with the terms and the error-report choice', async ({ page, shell, newApi, uid }) => {
    const registration = await (await newApi()).registration(newAccount(uid, 'Pending'));
    await shell.open(`#/verify/${registration.setupToken}`);
    const dialog = page.getByRole('dialog', { name: t('account.link.verifyTitle') });
    await dialog.getByRole('button', { name: t('account.link.verifyTitle') }).click();
    await expect(dialog.getByRole('checkbox', { name: t('auth.terms.accept') })).toBeVisible();
    await expect(dialog.getByRole('checkbox', { name: t('account.link.diagnostics') })).not.toBeChecked();
    await expectAccessible(page, { include: [DIALOG] });
    await dialog.getByRole('button', { name: t('auth.diagnostics.link') }).click();
    await expect(dialog.getByRole('heading', { name: t('terms.section.diagnostics.title') })).toBeInViewport();
    await expectAccessible(page, { include: [DIALOG] });
  });

  test('the operator contact address', async ({ page, shell }) => {
    await shell.open('#/terms');
    await shell.footer.getByRole('button', { name: t('account.contact.show') }).click();
    await expect(shell.footer.getByRole('link', { name: startsWith(t('account.contact', { email: '' })) })).toBeVisible();
    await settled(page);
    await expectAccessible(page);
  });

  for (const locale of locales) {
    test(`the footer with the source code and licence links (${locale})`, async ({ page, shell }) => {
      await page.addInitScript((value) => {
        try {
          localStorage.setItem('glazelab:locale', value);
        } catch {
          // about:blank has no storage.
        }
      }, locale);
      // Not `shell.open`, which waits for the English sign-in button.
      await page.goto('/#/terms');
      await expect(page.getByRole('heading', { level: 1, name: dictionaries[locale]['terms.title'] })).toBeVisible();
      const source = shell.footer.getByRole('link', { name: dictionaries[locale]['app.sourceCode'], exact: true });
      await expect(source).toHaveAttribute('href', SOURCE_URL);
      await expect(shell.footer.getByRole('link', { name: dictionaries[locale]['app.licences'], exact: true })).toHaveAttribute(
        'href',
        '/THIRD-PARTY-LICENSES.txt',
      );
      await settled(page);
      await expectAccessible(page, { include: ['footer'] });
    });
  }

  test('a buddy link asks a guest to sign in', async ({ page, shell, newApi, uid }) => {
    const ada = await newApi();
    await ada.signUp(newAccount(uid, 'Ada'));
    await shell.open(`#/buddy/${await ada.replaceBuddyLink()}`);
    await expect(page.getByRole('dialog', { name: t('buddies.request.title') })).toBeVisible();
    await expect(page.getByRole('dialog').getByText(t('buddies.request.signIn'))).toBeVisible();
    await expectAccessible(page, { include: [DIALOG] });
  });

  test('the barcode scanner', async ({ page, shell, context }) => {
    // The suite's fake capture device (`playwright.config.ts`); a real camera is never reached.
    await context.grantPermissions(['camera']);
    await shell.open();
    await page
      .getByRole('main')
      .getByRole('button', { name: t('barcodes.scan') })
      .click();
    const scanner = page.getByRole('dialog', { name: t('barcodes.scanner.findTitle') });
    await expect(scanner).toBeVisible();
    await expect(scanner.getByLabel(t('barcodes.scanner.camera'))).toBeVisible();
    await expectAccessible(page, { include: [DIALOG] });
  });

  test('filter sheet', async ({ page, shell, isMobile }) => {
    test.skip(!isMobile, 'the filter sheet exists below 720 px only');
    await shell.open();
    await page.getByRole('button', { name: t('discover.filters.open', { count: 0 }) }).click();
    await expect(page.getByRole('dialog', { name: t('discover.filters.title') })).toBeVisible();
    await expectAccessible(page, { include: [DIALOG] });
  });
});

test.describe('signed in', () => {
  test('Explore with cards, photos and quick views', async ({ page, shell, library, signedIn }) => {
    await shell.open(`#/?q=${library.naming.uid}`);
    await shell.expectSignedIn(signedIn.displayName);
    await firstCardPhoto(page);
    await settled(page);
    await expectAccessible(page);
  });

  test('the Explore intro card with a ticked step, and the account page opened at error reports by its link', async ({ page, shell, api, signedIn }) => {
    await api.setDiagnostics(true);
    await shell.open('#/');
    await shell.expectSignedIn(signedIn.displayName);
    const card = page.getByRole('main').getByRole('complementary', { name: t('discover.onboarding.title') });
    const reports = card.getByRole('link', { name: t('discover.onboarding.completed', { step: t('discover.onboarding.diagnostics') }) });
    await expect(reports).toBeVisible();
    await settled(page);
    await expectAccessible(page);
    await reports.click();
    await expect(page.getByRole('main').getByRole('heading', { level: 2, name: t('account.page.diagnostics.title') })).toBeFocused();
    await settled(page);
    await expectAccessible(page);
  });

  test("Explore's cards with their photo buttons, and the card's photo viewer open", async ({ page, shell, api, signedIn, uid }) => {
    const title = `Card viewer ${uid}`;
    const id = await api.addCombination({ title, steps: [BISQUE_STEP], tags: ['cone-6'] });
    for (const kind of ['TEST_TILE', 'FINISHED', 'FINISHED', 'TEST_TILE'] as const) {
      await api.uploadToCombination(id, { file: photoPng('tile.png', 480, 360), kind, caption: 'Two coats', firedOn: '2026-10-18' });
    }
    await shell.open(`#/?type=combinations&q=${uid}`);
    await shell.expectSignedIn(signedIn.displayName);
    const cover = page.getByRole('button', { name: t('images.cover.open', { title }) });
    await expect(cover).toBeVisible();
    await settled(page);
    await expectAccessible(page);
    await page.getByRole('button', { name: t('images.thumbnail.open', { current: 2, total: 4, title }) }).click();
    const viewer = page.getByRole('dialog', { name: t('images.viewer.label', { title }) });
    await expect(viewer.getByText('2 / 4', { exact: true })).toBeVisible();
    await expect.poll(() => viewer.evaluate((element) => [...element.querySelectorAll('img')].every((image) => image.complete))).toBe(true);
    await expectAccessible(page, { include: [DIALOG] });
  });

  test('the QR scanner of the buddy section and of the Clubs page', async ({ page, shell, context, signedIn }) => {
    // The suite's fake capture device (`playwright.config.ts`); a real camera is never reached.
    await context.grantPermissions(['camera']);
    for (const [hash, label] of [
      ['#/account', t('buddies.scan')],
      ['#/clubs', t('clubs.scan')],
    ]) {
      await shell.open(hash);
      await shell.expectSignedIn(signedIn.displayName);
      await page.getByRole('main').getByRole('button', { name: label }).click();
      const scanner = page.getByRole('dialog', { name: label });
      await expect(scanner.getByLabel(t('barcodes.scanner.camera'))).toBeVisible();
      await expect(scanner.getByText(t('links.scanner.hint'))).toBeVisible();
      await expectAccessible(page, { include: [DIALOG] });
      await page.keyboard.press('Escape');
      await expect(scanner).toBeHidden();
    }
  });

  test('the phone account menu with its scan entry open, and its QR scanner', async ({ page, shell, context, signedIn, isMobile }) => {
    test.skip(!isMobile, 'the account menu is a phone control');
    await context.grantPermissions(['camera']);
    await shell.open('#/');
    await shell.expectSignedIn(signedIn.displayName);
    const trigger = shell.header.getByRole('button', { name: t('header.accountMenu', { name: signedIn.displayName }) });
    await trigger.click();
    const entry = shell.header.getByRole('button', { name: t('header.scan') });
    await expect(entry).toBeVisible();
    await expectAccessible(page);
    await entry.click();
    const scanner = page.getByRole('dialog', { name: t('links.scanner.title') });
    await expect(scanner.getByLabel(t('barcodes.scanner.camera'))).toBeVisible();
    await expect(scanner.getByText(t('links.scanner.hint'))).toBeVisible();
    await expectAccessible(page, { include: [DIALOG] });
    await page.keyboard.press('Escape');
    await expect(scanner).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('combination page with an own photo and its menu', async ({ page, shell, api, signedIn, uid }) => {
    const title = `Own tile ${uid}`;
    const id = await api.addCombination({ title, steps: [BISQUE_STEP], tags: ['cone-6'] });
    await api.uploadToCombination(id, { file: photoPng('tile.png', 480, 360) });
    await shell.open(`#/combinations/${id}`);
    await shell.expectSignedIn(signedIn.displayName);
    await expect(page.getByRole('img', { name: t('images.alt.tile', { title }) })).toBeVisible();
    await settled(page);
    await expectAccessible(page);
    await page.getByRole('button', { name: t('images.menu.label') }).click();
    await expect(page.getByRole('menuitem', { name: t('images.menu.details') })).toBeVisible();
    await expectAccessible(page);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: t('tags.edit') }).click();
    await page.getByRole('combobox', { name: t('tags.add') }).fill('sa');
    await expect(page.getByRole('listbox')).toBeVisible();
    await expectAccessible(page);
  });

  test('delete-combination dialog', async ({ page, shell, api, signedIn, uid }) => {
    const id = await api.addCombination({ title: `Delete ${uid}`, steps: [BISQUE_STEP] });
    await shell.open(`#/combinations/${id}`);
    await shell.expectSignedIn(signedIn.displayName);
    await page.getByRole('button', { name: t('combination.delete.confirm') }).click();
    await expect(page.getByRole('dialog', { name: t('combination.delete.title') })).toBeVisible();
    await expectAccessible(page, { include: [DIALOG] });
  });

  test('the question when leaving a Studio draft', async ({ page, shell, signedIn, uid }) => {
    await shell.open('#/studio');
    await shell.expectSignedIn(signedIn.displayName);
    await new StudioPage(page).title.fill(`Unsaved ${uid}`);
    // The bottom navigation is gone while the draft has input: the brand link leaves.
    await shell.header.getByRole('link', { name: t('nav.home') }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expectAccessible(page, { include: [DIALOG] });
  });

  test('a club invitation', async ({ page, shell, newApi, signedIn, uid }) => {
    const admin = await newApi();
    await admin.signUp(newAccount(uid, 'Cleo'));
    const { token } = await admin.clubWithInvite(`Invite ${uid}`);
    await shell.open(`#/invite/${token}`);
    await shell.expectSignedIn(signedIn.displayName);
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog').getByText(`Invite ${uid}`)).toBeVisible();
    await expectAccessible(page, { include: [DIALOG] });
  });

  test('combination page of a variation', async ({ page, shell, api, library, signedIn, uid }) => {
    const id = await api.addCombination({ title: `Variation ${uid}`, steps: [BISQUE_STEP], basedOnId: celadon(library) });
    await shell.open(`#/combinations/${id}`);
    await shell.expectSignedIn(signedIn.displayName);
    await settled(page);
    await expectAccessible(page);
  });

  test('combination page of a draft', async ({ page, shell, api, signedIn, uid }) => {
    const id = await api.addCombination({ title: `Draft ${uid}`, steps: [BISQUE_STEP], draft: true });
    await shell.open(`#/combinations/${id}`);
    await shell.expectSignedIn(signedIn.displayName);
    await expect(page.getByRole('button', { name: t('combination.publish') })).toBeVisible();
    await settled(page);
    await expectAccessible(page);
  });

  test('combination page of another member with photos and the outlined photo buttons', async ({ page, shell, library, signedIn }) => {
    await shell.open(`#/combinations/${celadon(library)}`);
    await shell.expectSignedIn(signedIn.displayName);
    await expect(page.getByRole('main').getByRole('button', { name: t('images.addTestTile') })).toBeVisible();
    await settled(page);
    await expectAccessible(page);
  });

  test('combination page with four photos, the thumbnail row and the second photo shown', async ({ page, shell, api, signedIn, uid }) => {
    const title = `Four photos ${uid}`;
    const id = await api.addCombination({ title, steps: [BISQUE_STEP], tags: ['cone-6'] });
    for (const kind of ['TEST_TILE', 'FINISHED', 'FINISHED', 'TEST_TILE'] as const) {
      await api.uploadToCombination(id, { file: photoPng('tile.png', 480, 360), kind, caption: 'Two coats', firedOn: '2026-10-18' });
    }
    await shell.open(`#/combinations/${id}`);
    await shell.expectSignedIn(signedIn.displayName);
    const second = page.getByRole('button', { name: t('images.thumbnail', { current: 2, total: 4, kind: t('images.kind.finished') }) });
    await expect(second).toBeVisible();
    await settled(page);
    await expectAccessible(page);
    await second.click();
    await expect(second).toHaveAttribute('aria-current', 'true');
    await settled(page);
    await expectAccessible(page);
  });

  test('combination page with shelf marks and the gallery beside the recipe', async ({ page, shell, api, library, signedIn }) => {
    await api.addStock({ glazeId: glazeId(library), ownerType: 'personal', quantityG: 400, jarSizeG: 500 });
    await shell.open(`#/combinations/${celadon(library)}`);
    await shell.expectSignedIn(signedIn.displayName);
    const main = page.getByRole('main');
    await expect(main.getByText(t('combination.shelf.on'), { exact: true })).toBeVisible();
    await expect(main.getByText(t('combination.shelf.off'), { exact: true })).toBeVisible();
    await settled(page);
    await expectAccessible(page);
  });

  test('combination page with a buddy mark and Ask beside a missing glaze', async ({ page, shell, api, newApi, library, signedIn, uid }) => {
    await api.addStock({ glazeId: library.glazes.get(library.naming.glaze('Botz', 'SH-2'))!, ownerType: 'personal', quantityG: 400 });
    await buddiesWith(api, newApi, uid, ['Ada', 'Ben'], glazeId(library));
    await shell.open(`#/combinations/${celadon(library)}`);
    await shell.expectSignedIn(signedIn.displayName);
    const main = page.getByRole('main');
    await expect(main.getByText(t('buddies.shelf.atNames', { names: "Ada's and Ben's" }), { exact: true })).toBeVisible();
    await expect(main.getByRole('button', { name: startsWith('Ask Ada') })).toBeVisible();
    await settled(page);
    await expectAccessible(page);
  });

  test('combination page with more than three buddies, the names in the opened details', async ({ page, shell, api, newApi, library, signedIn, uid }) => {
    await api.addStock({ glazeId: library.glazes.get(library.naming.glaze('Botz', 'SH-2'))!, ownerType: 'personal', quantityG: 400 });
    await buddiesWith(api, newApi, uid, ['Ada', 'Ben', 'Dee', 'Eli'], glazeId(library));
    await shell.open(`#/combinations/${celadon(library)}`);
    await shell.expectSignedIn(signedIn.displayName);
    const main = page.getByRole('main');
    await main.getByText(t('buddies.shelf.atCount', { count: 4 }), { exact: true }).click();
    await expect(main.getByRole('button', { name: startsWith('Ask Eli') })).toBeVisible();
    await settled(page);
    await expectAccessible(page);
  });

  test('I can make now with Include buddies on, the glaze page line and the shelf with Keep private', async ({
    page,
    shell,
    api,
    newApi,
    library,
    signedIn,
    uid,
  }) => {
    await api.addStock({ glazeId: library.glazes.get(library.naming.glaze('Botz', 'SH-2'))!, ownerType: 'personal', quantityG: 400 });
    await buddiesWith(api, newApi, uid, ['Ada'], glazeId(library));
    await shell.open('#/?type=combinations&quick=canMake');
    await shell.expectSignedIn(signedIn.displayName);
    const main = page.getByRole('main');
    await main.getByRole('checkbox', { name: startsWith(t('discover.buddies.include')) }).check();
    await expect(main.getByText(startsWith(t('buddies.shelf.restAll', { groups: '' })))).toBeVisible();
    await settled(page);
    await expectAccessible(page);
    await shell.open(`#/glazes/${glazeId(library)}`);
    await expect(main.getByText(t('buddies.shelf.glazeHolders', { names: 'Ada' }), { exact: true })).toBeVisible();
    await expect(main.getByRole('button', { name: startsWith(t('buddies.shelf.ask', { name: 'Ada' })) })).toBeVisible();
    await settled(page);
    await expectAccessible(page);
    await shell.open('#/stock');
    await expect(main.getByRole('checkbox', { name: startsWith(t('stock.row.keepPrivate')) })).toBeVisible();
    await settled(page);
    await expectAccessible(page);
  });

  test('the manual copy of an Ask message', async ({ page, shell, api, newApi, library, signedIn, uid }) => {
    await api.addStock({ glazeId: library.glazes.get(library.naming.glaze('Botz', 'SH-2'))!, ownerType: 'personal', quantityG: 400 });
    await buddiesWith(api, newApi, uid, ['Ada'], glazeId(library));
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) } });
    });
    await shell.open(`#/combinations/${celadon(library)}`);
    await shell.expectSignedIn(signedIn.displayName);
    await page
      .getByRole('main')
      .getByRole('button', { name: startsWith('Ask Ada') })
      .click();
    await expect(page.getByRole('dialog', { name: t('buddies.shelf.manualTitle') })).toBeVisible();
    await expectAccessible(page, { include: [DIALOG] });
  });

  test('own combination without a photo or tags offers Add tags', async ({ page, shell, api, signedIn, uid }) => {
    const id = await api.addCombination({ title: `Plain ${uid}`, steps: [BISQUE_STEP] });
    await shell.open(`#/combinations/${id}`);
    await shell.expectSignedIn(signedIn.displayName);
    await expect(page.getByRole('main').getByRole('button', { name: t('tags.addFirst') })).toBeVisible();
    await settled(page);
    await expectAccessible(page);
  });

  test('glaze page signed in, with a gallery of its own photos and the combinations', async ({ page, shell, api, library, signedIn, uid }) => {
    const glaze = await api.addGlaze({
      newManufacturer: { name: `Gallery ${uid}`, shortId: `${uid}1` },
      code: 'GP-1',
      name: 'Gallery glaze',
      notes: 'Cone 6.',
    });
    await api.uploadToGlaze(glaze.id, { file: photoPng('own.png', 480, 360), caption: 'Own test tile' });
    await api.uploadToGlaze(glaze.id, { file: photoPng('bucket.png', 480, 360), kind: 'PACKAGING' });
    await api.addCombination({ title: `Uses it ${uid}`, steps: [{ type: 'GLAZE', glazeId: glaze.id, coats: 2 }], tags: ['cone-6'] });
    await shell.open(`#/glazes/${glaze.id}`);
    await shell.expectSignedIn(signedIn.displayName);
    await expect(page.getByRole('main').getByRole('heading', { level: 1, name: 'Gallery glaze' })).toBeVisible();
    await expect(page.getByRole('main').getByRole('img').first()).toBeVisible();
    await settled(page);
    await expectAccessible(page);
    // A library glaze, whose gallery borrows the finished pieces of the combinations that use it.
    await shell.open(`#/glazes/${glazeId(library)}`);
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
    await settled(page);
    await expectAccessible(page);
  });

  test('glaze page with stock on the shelf', async ({ page, shell, api, library, signedIn }) => {
    await api.addStock({ glazeId: glazeId(library), ownerType: 'personal', quantityG: 400, jarSizeG: 500 });
    await shell.open(`#/glazes/${glazeId(library)}`);
    await shell.expectSignedIn(signedIn.displayName);
    await expect(page.getByRole('main').getByText('400 g').first()).toBeVisible();
    await settled(page);
    await expectAccessible(page);
  });

  test('a club shelf: its scope header, club groups and the forms that name the club', async ({ page, shell, api, library, signedIn }) => {
    const club = (await api.createClub(`Kiln ${library.naming.uid}`)).id;
    await api.addStock({ glazeId: glazeId(library), ownerType: 'club', clubId: club, quantityG: 800 });
    const main = page.getByRole('main');
    await shell.open(`#/stock?shelf=${club}&glaze=${glazeId(library)}`);
    await shell.expectSignedIn(signedIn.displayName);
    await expect(main.getByRole('region', { name: t('stock.scope.label') })).toContainText(t('stock.scope.club'));
    await expect(main.getByRole('button', { name: t('stock.target.updateClub', { club: `Kiln ${library.naming.uid}` }), exact: true })).toBeVisible();
    await settled(page);
    await expectAccessible(page);
    // All shelves, with the club group beside the personal one.
    await shell.open('#/stock');
    await expect(main.getByRole('region', { name: t('stock.scope.label') })).toContainText(t('stock.scope.all'));
    await settled(page);
    await expectAccessible(page);
  });

  test('Explore glaze rows with the one-click shelf "+", a long title and the error', async ({ page, shell, api, library, signedIn }) => {
    await api.addGlaze({
      newManufacturer: { name: `Zusammengesetzte Glasurenmanufaktur ${library.naming.uid}`, shortId: `${library.naming.uid}Z`.slice(0, 10) },
      code: 'LANG-1',
      name: 'Außergewöhnlich langer Glasurname mit Donaudampfschifffahrtsgesellschaft',
    });
    await page.route('**/api/stock/add', (route) =>
      route.request().method() === 'POST' ? route.fulfill({ status: 400, json: { error: 'Unknown glaze' } }) : route.fallback(),
    );
    await shell.open(`#/?type=glazes&q=${library.naming.uid}`);
    await shell.expectSignedIn(signedIn.displayName);
    const quick = page.getByRole('main').locator('.glaze-row__quick');
    await expect(quick.first()).toBeVisible();
    await settled(page);
    await expectAccessible(page);
    await quick.first().click();
    await expect(page.getByRole('main').getByRole('alert').first()).toBeVisible();
    await expectAccessible(page);
  });

  test('Explore with "On my shelf" and its stock choices', async ({ page, shell, api, library, signedIn }) => {
    await api.addStock({ glazeId: glazeId(library), ownerType: 'personal', quantityG: 400, jarSizeG: 500 });
    await api.addStock({ glazeId: library.glazes.get(library.naming.glaze('Amaco', 'PC-20'))!, ownerType: 'personal', quantityG: 0 });
    await shell.open('#/?type=glazes&quick=shelf&stock=used');
    await shell.expectSignedIn(signedIn.displayName);
    await expect(page.getByRole('main').getByRole('group', { name: SHELF_STOCK_GROUP }).getByRole('link')).toHaveCount(3);
    await settled(page);
    await expectAccessible(page);
  });

  test('Explore with "Available to me" and its club and buddy options', async ({ page, shell, api, newApi, library, signedIn, uid }) => {
    await api.addStock({ glazeId: glazeId(library), ownerType: 'personal', quantityG: 400, jarSizeG: 500 });
    const club = await api.createClub(`Club ${uid}`);
    await api.addStock({ glazeId: library.glazes.get(library.naming.glaze('Botz', 'SH-2'))!, ownerType: 'club', clubId: club.id, quantityG: 300 });
    await buddiesWith(api, newApi, uid, ['Ada'], library.glazes.get(library.naming.glaze('Amaco', 'PC-20'))!);
    await shell.open('#/?type=glazes&quick=available&clubs=1&buddies=1');
    await shell.expectSignedIn(signedIn.displayName);
    await expect(page.getByRole('main').getByRole('checkbox', { name: SHELF_OPTIONS })).toHaveCount(2);
    await expect(
      page
        .getByRole('main')
        .getByRole('button', { name: anyLanguage('buddies.shelf.ask', { name: 'Ada' }) })
        .first(),
    ).toBeVisible();
    await settled(page);
    await expectAccessible(page);
  });

  test('Shelf with stock', async ({ page, shell, api, library, signedIn }) => {
    await api.addStock({ glazeId: glazeId(library), ownerType: 'personal', quantityG: 400, jarSizeG: 500 });
    await api.addStock({ glazeId: library.glazes.get(library.naming.glaze('Amaco', 'PC-20'))!, ownerType: 'personal', quantityG: 0 });
    await shell.open('#/stock');
    await shell.expectSignedIn(signedIn.displayName);
    await expect(page.getByRole('main').getByText('Celadon').first()).toBeVisible();
    await settled(page);
    await expectAccessible(page);
  });

  test('Shelf filtered to a club shelf', async ({ page, shell, api, library, signedIn, uid }) => {
    const { club } = await api.clubWithInvite(`Sunday Clay ${uid}`);
    await api.addStock({ glazeId: glazeId(library), ownerType: 'personal', quantityG: 400, jarSizeG: 500 });
    await api.addStock({ glazeId: glazeId(library), ownerType: 'club', clubId: club.id, quantityG: 250 });
    await shell.open(`#/stock?shelf=${club.id}`);
    await shell.expectSignedIn(signedIn.displayName);
    await expect(page.getByRole('main').getByRole('group', { name: t('stock.shelves.label') })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: t('stock.group.club', { club: `Sunday Clay ${uid}` }) })).toBeVisible();
    await settled(page);
    await expectAccessible(page);
  });

  test('Studio, new', async ({ page, shell, signedIn }) => {
    await shell.open('#/studio');
    await shell.expectSignedIn(signedIn.displayName);
    await settled(page);
    await expectAccessible(page);
  });

  test('Studio with steps', async ({ page, shell, library, signedIn, uid }) => {
    await shell.open('#/studio');
    await shell.expectSignedIn(signedIn.displayName);
    const studio = new StudioPage(page);
    await studio.addGlazeStep(library.naming.glaze('Botz', 'SH-2'));
    await studio.addGlazeStep(library.naming.glaze('Botz', 'CE-1'));
    await studio.title.fill(`Two coats ${uid}`);
    // The folded final firing (phones) open as well.
    const folded = page.getByRole('main').getByRole('button', { expanded: false });
    for (let attempt = 0; attempt < 5 && (await folded.count()); attempt++) await folded.last().click();
    await settled(page);
    await expectAccessible(page);
  });

  test('Studio with photos attached, one of them refused', async ({ page, shell, signedIn }) => {
    await shell.open('#/studio');
    await shell.expectSignedIn(signedIn.displayName);
    await page
      .getByRole('main')
      .getByLabel(t('upload.library'))
      .setInputFiles([png('tile.png'), png('bowl.png'), { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a photo') }]);
    await expect(
      page
        .getByRole('main')
        .getByRole('list', { name: t('upload.list') })
        .getByRole('listitem'),
    ).toHaveCount(2);
    await expect(page.getByRole('main').getByRole('alert')).toContainText('notes.txt');
    await settled(page);
    await expectAccessible(page);
  });

  test('Studio with its waiting list and drafts', async ({ page, shell, api, signedIn, uid, isMobile }) => {
    await api.addCombination({ title: `No photo ${uid}`, steps: [BISQUE_STEP] });
    await api.addCombination({ title: `Draft ${uid}`, steps: [], draft: true });
    await shell.open('#/studio');
    await shell.expectSignedIn(signedIn.displayName);
    // On phones both lists are folded behind their headings: open them.
    const folded = page.getByRole('main').getByRole('button', { expanded: false });
    if (isMobile) {
      await expect(folded.first()).toBeVisible();
      for (let attempt = 0; attempt < 5 && (await folded.count()); attempt++) await folded.first().click();
    }
    // The waiting list holds the five newest of every shared glaze and the account's own combinations, so glazes other tests
    // add meanwhile can push `No photo` out of it (E2E-a11y-1): wait for a row, and for the account's own draft.
    await expect(
      page
        .getByRole('main')
        .getByRole('list', { name: t('discover.quick.waiting') })
        .getByRole('listitem')
        .first(),
    ).toBeVisible();
    await expect(page.getByRole('main').getByText(`Draft ${uid}`)).toBeVisible();
    await settled(page);
    await expectAccessible(page);
  });

  test('Studio with an open glaze picker', async ({ page, shell, library, signedIn }) => {
    await shell.open('#/studio');
    await shell.expectSignedIn(signedIn.displayName);
    await page
      .getByRole('main')
      .getByRole('button', { name: t('studio.addGlazeStep') })
      .last()
      .click();
    await page
      .getByRole('main')
      .getByRole('combobox', { name: t('common.glaze') })
      .fill(library.naming.manufacturer('Botz'));
    await expect(page.getByRole('listbox').getByRole('option').first()).toBeVisible();
    await expectAccessible(page);
  });

  test('Studio, editing a combination', async ({ page, shell, api, signedIn, uid }) => {
    const id = await api.addCombination({ title: `Edit me ${uid}`, steps: [BISQUE_STEP], cone: '6' });
    await shell.open(`#/studio/${id}`);
    await shell.expectSignedIn(signedIn.displayName);
    await expect(new StudioPage(page).title).toHaveValue(`Edit me ${uid}`);
    await settled(page);
    await expectAccessible(page);
  });

  test('Clubs with a club', async ({ page, shell, api, signedIn, uid }) => {
    await api.clubWithInvite(`Sunday Clay ${uid}`);
    await shell.open('#/clubs');
    await shell.expectSignedIn(signedIn.displayName);
    await expect(page.getByRole('heading', { name: `Sunday Clay ${uid}` })).toBeVisible();
    await settled(page);
    await expectAccessible(page);
  });

  test('Clubs without a club', async ({ page, shell, signedIn }) => {
    await shell.open('#/clubs');
    await shell.expectSignedIn(signedIn.displayName);
    await expect(page.getByRole('main').getByText(t('clubs.joinHint'))).toBeVisible();
    await settled(page);
    await expectAccessible(page);
  });

  test('Clubs with several cards, a refused Leave club and the start form open', async ({ page, shell, api, newApi, signedIn, uid }) => {
    const cleo = await newApi();
    await cleo.signUp(newAccount(uid, 'Cleo'));
    const { club, token } = await api.clubWithInvite(`Sunday Clay ${uid}`);
    await cleo.joinClub(token);
    await api.updateClub(club.id, { name: `Sunday Clay ${uid}`, houseRules: '', invitesEnabled: true });
    await api.clubWithInvite(`alpha ${uid}`);
    const mid = await cleo.clubWithInvite(`Mid ${uid}`);
    await api.joinClub(mid.token);
    await shell.open('#/clubs');
    await shell.expectSignedIn(signedIn.displayName);
    const main = page.getByRole('main');
    await expect(main.getByRole('article')).toHaveCount(3);
    await expect(main.getByText(t('clubs.leave.lastAdmin'))).toBeVisible();
    await main.getByText(t('clubs.create.title'), { exact: true }).click();
    await expect(main.getByRole('textbox', { name: t('clubs.name') })).toBeVisible();
    await settled(page);
    await expectAccessible(page);
  });

  test('a club page as admin with the invite panel, the QR code and Save button and the settings open', async ({ page, shell, api, newApi, signedIn, uid }) => {
    const { club, token } = await api.clubWithInvite(`Sunday Clay ${uid}`);
    await api.updateClub(club.id, { name: `Sunday Clay ${uid}`, houseRules: 'Wipe the foot.\n'.repeat(9), invitesEnabled: true });
    const bo = await newApi();
    await bo.signUp(newAccount(uid, 'Bo'));
    await bo.joinClub(token);
    await shell.open(`#/clubs/${club.id}`);
    await shell.expectSignedIn(signedIn.displayName);
    const main = page.getByRole('main');
    await main.getByRole('button', { name: t('clubs.page.invite') }).click();
    await main.getByRole('button', { name: t('clubs.settings.invites.replace') }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: t('clubs.settings.invites.confirm') })
      .click();
    await expect(main.getByRole('textbox', { name: t('clubs.settings.invites.link') })).toBeVisible();
    await expect(main.getByRole('img', { name: t('qr.label') })).toBeVisible();
    await main.getByRole('button', { name: t('clubs.settings.title'), exact: true }).click();
    await expect(main.getByRole('heading', { level: 3, name: t('clubs.settings.members'), exact: true })).toBeVisible();
    await settled(page);
    await expectAccessible(page);
  });

  test('a club page as a plain member', async ({ page, shell, newApi, signedIn, uid }) => {
    const admin = await newApi();
    await admin.signUp(newAccount(uid, 'Cleo'));
    const { club, token } = await admin.clubWithInvite(`Sunday Clay ${uid}`);
    await admin.updateClub(club.id, { name: `Sunday Clay ${uid}`, houseRules: 'Wipe the foot.\n'.repeat(9), invitesEnabled: true });
    await shell.open('#/');
    await shell.expectSignedIn(signedIn.displayName);
    await page.evaluate((link) => (location.hash = link), `#/invite/${token}`);
    await page.getByRole('button', { name: t('clubs.invite.join') }).click();
    await expect(page).toHaveURL(new RegExp(`#/clubs/${club.id}$`));
    await expect(page.getByRole('main').getByText(t('clubs.page.inviteAsk', { admins: 'Cleo' }))).toBeVisible();
    await settled(page);
    await expectAccessible(page);
  });

  test('a club page with a combination', async ({ page, shell, api, signedIn, uid }) => {
    const { club } = await api.clubWithInvite(`Sunday Clay ${uid}`);
    await api.addCombination({ title: `Club tile ${uid}`, steps: [BISQUE_STEP] });
    await shell.open(`#/clubs/${club.id}`);
    await shell.expectSignedIn(signedIn.displayName);
    await expect(page.getByRole('main').getByRole('article')).toHaveCount(1);
    await settled(page);
    await expectAccessible(page);
  });

  test('a club page with a wishlist of a glaze, an acquired item and another member’s entry', async ({ page, shell, api, newApi, signedIn, uid }) => {
    const cleo = await newApi();
    await cleo.signUp(newAccount(uid, 'Cleo'));
    const { club, token } = await cleo.clubWithInvite(`Sunday Clay ${uid}`);
    await api.joinClub(token);
    const glaze = await cleo.addGlaze({ newManufacturer: { name: `Wish ${uid}`, shortId: uid.toUpperCase() }, code: 'WL-1', name: 'Celadon' });
    await api.addWishlistEntry(club.id, { type: 'GLAZE', glazeId: glaze.id, note: 'For the beginners' });
    const item = await api.addWishlistEntry(club.id, { type: 'ITEM', name: 'Kiln shelf', link: 'https://shop.example.test/shelf' });
    await cleo.setWishlistAcquired(club.id, item.id, true);
    await cleo.addWishlistEntry(club.id, { type: 'ITEM', name: 'Banding wheel', link: 'https://tools.example.test/wheel' });
    await shell.open(`#/clubs/${club.id}`);
    await shell.expectSignedIn(signedIn.displayName);
    await expect(page.locator('#club-wishlist').getByRole('listitem')).toHaveCount(3);
    await settled(page);
    await expectAccessible(page);
  });

  test('the wishlist dialogs: a glaze picked by its code and an item with a refused link', async ({ page, shell, api, signedIn, uid }) => {
    await api.addGlaze({ newManufacturer: { name: `Wish ${uid}`, shortId: uid.toUpperCase() }, code: 'WL-1', name: 'Celadon' });
    const { id } = await api.createClub(`Sunday Clay ${uid}`);
    await shell.open(`#/clubs/${id}`);
    await shell.expectSignedIn(signedIn.displayName);
    const wishlist = page.locator('#club-wishlist');
    await wishlist.getByRole('button', { name: t('clubs.wishlist.addGlaze') }).click();
    const glazeDialog = page.getByRole('dialog', { name: t('clubs.wishlist.glazeTitle') });
    await glazeDialog.getByRole('combobox', { name: t('clubs.wishlist.glaze') }).fill('WL-1');
    await expect(page.getByRole('option', { name: new RegExp(uid) })).toBeVisible();
    await expectAccessible(page, { include: [DIALOG] });
    await page.getByRole('option', { name: new RegExp(uid) }).click();
    await glazeDialog.getByRole('button', { name: t('common.cancel') }).click();
    await wishlist.getByRole('button', { name: t('clubs.wishlist.addItem') }).click();
    const itemDialog = page.getByRole('dialog', { name: t('clubs.wishlist.itemTitle') });
    await itemDialog.getByRole('textbox', { name: t('clubs.wishlist.itemName') }).fill('Kiln shelf');
    await itemDialog.getByRole('textbox', { name: t('clubs.wishlist.link') }).fill('ftp://shop.example.test/shelf');
    await itemDialog.getByRole('button', { name: t('clubs.wishlist.submit') }).click();
    await expect(itemDialog.getByText(t('errors.wishlistLinkInvalid'))).toBeVisible();
    await expectAccessible(page, { include: [DIALOG] });
  });

  test('the account page', async ({ page, shell, signedIn }) => {
    await shell.open();
    await shell.expectSignedIn(signedIn.displayName);
    await shell.openAccountPage(signedIn.displayName);
    await expect(page.getByRole('main').getByText(signedIn.email)).toBeVisible();
    await settled(page);
    await expectAccessible(page);
  });

  test('the account page error report switch, off and on, with What is sent open', async ({ page, shell, api, signedIn }) => {
    await shell.open('#/account');
    await shell.expectSignedIn(signedIn.displayName);
    const main = page.getByRole('main');
    await main.getByText(t('account.page.diagnostics.sent.title')).click();
    await expect(main.getByText(t('account.page.diagnostics.sent.never'))).toBeVisible();
    await expectAccessible(page);
    await main.getByRole('switch', { name: t('account.page.diagnostics.switch') }).check();
    await expect(page.getByText(t('notices.diagnosticsOn'))).toBeVisible();
    await expect(main.getByRole('switch', { name: t('account.page.diagnostics.switch') })).toBeChecked();
    expect((await api.me()).diagnosticsOptIn).toBe(true);
    await expectAccessible(page);
  });

  test('the sign-up dialog with the terms open', async ({ page, shell }) => {
    await shell.open();
    await shell.signInButton().click();
    const dialog = page.getByRole('dialog', { name: t('auth.dialogLabel') });
    await dialog.getByRole('button', { name: t('auth.register.switch') }).click();
    await dialog.getByText(t('auth.terms.read')).click();
    await expect(dialog.getByRole('heading', { name: t('terms.section.diagnostics.title') })).toBeVisible();
    await expectAccessible(page, { include: [DIALOG] });
  });

  test('the account page with a profile picture, and its crop and remove dialogs', async ({ page, shell, api, signedIn: _ }) => {
    await api.uploadAvatar(twoTonePicture());
    await shell.open('#/account');
    const avatar = new AvatarSection(page);
    await expect(avatar.shownPicture()).toBeVisible();
    await expect(avatar.headerPicture(shell)).toBeVisible();
    await settled(page);
    await expectAccessible(page);
    await avatar.pick(twoTonePicture());
    await expect(avatar.save).toBeEnabled();
    await expectAccessible(page, { include: [DIALOG] });
    await avatar.crop.getByRole('button', { name: t('common.cancel') }).click();
    await avatar.remove.click();
    await expect(avatar.removal).toBeVisible();
    await expectAccessible(page, { include: [DIALOG] });
  });

  test('the crop dialog with a picture that cannot be read', async ({ page, shell, signedIn: _ }) => {
    await shell.open('#/account');
    const avatar = new AvatarSection(page);
    await avatar.pick({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not a png') });
    await expect(avatar.crop.getByRole('alert')).toBeVisible();
    await expectAccessible(page, { include: [DIALOG] });
  });

  test('the crop dialog refusing a picture that is too small or too large', async ({ page, shell, signedIn: _ }) => {
    await shell.open('#/account');
    const avatar = new AvatarSection(page);
    await avatar.pick(paintedPng('tiny.png', 40, 30, () => [220, 40, 40]));
    await expect(avatar.crop.getByRole('alert')).toHaveText(t('account.avatar.problem.tooSmall', { min: 64 }));
    await expectAccessible(page, { include: [DIALOG] });
    await avatar.crop.getByRole('button', { name: t('common.cancel') }).click();
    await avatar.pick(pngHeaderOnly('huge.png', 10_000, 10_000));
    await expect(avatar.crop.getByRole('alert')).toHaveText(t('account.avatar.problem.tooManyPixels', { max: 50 }));
    await expectAccessible(page, { include: [DIALOG] });
  });

  test('the crop dialog with the announcement of a key and the encoding error', async ({ page, shell, signedIn: _ }) => {
    await shell.open('#/account');
    const avatar = new AvatarSection(page);
    await avatar.pick(twoTonePicture());
    await expect(avatar.save).toBeEnabled();
    await avatar.stage.press('+');
    await expect(avatar.crop.getByRole('status')).toHaveText(t('crop.position', { zoom: 125, x: 50, y: 50 }));
    await page.evaluate(() => {
      HTMLCanvasElement.prototype.toBlob = (callback) => callback(null);
    });
    await avatar.save.click();
    await expect(avatar.crop.getByRole('alert')).toHaveText(t('account.avatar.processFailed'));
    await expectAccessible(page, { include: [DIALOG] });
  });

  test('the account page with a buddy, two requests, the buddy link and its code', async ({ page, shell, api, newApi, signedIn, uid }) => {
    await withBuddies(api, newApi, uid);
    await shell.open('#/account');
    await shell.expectSignedIn(signedIn.displayName);
    const main = page.getByRole('main');
    await main.getByRole('button', { name: t('buddies.link.replace') }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: t('buddies.link.confirm') })
      .click();
    await expect(main.getByRole('textbox', { name: t('buddies.link.field') })).toBeVisible();
    await expect(main.getByRole('img', { name: t('qr.label') })).toBeVisible();
    await expect(main.getByRole('listitem').filter({ hasText: 'Cy' })).toBeVisible();
    await expect(main.getByRole('listitem').filter({ hasText: 'Dee' })).toBeVisible();
    await settled(page);
    await expectAccessible(page);
  });

  test('the account page without buddies', async ({ page, shell, signedIn }) => {
    await shell.open('#/account');
    await shell.expectSignedIn(signedIn.displayName);
    await expect(page.getByRole('main').getByText(t('buddies.list.empty'))).toBeVisible();
    await settled(page);
    await expectAccessible(page);
  });

  test('the remove-buddy and replace-link dialogs', async ({ page, shell, api, newApi, signedIn, uid }) => {
    await withBuddies(api, newApi, uid);
    await shell.open('#/account');
    await shell.expectSignedIn(signedIn.displayName);
    const main = page.getByRole('main');
    await main.getByRole('button', { name: t('buddies.remove.label', { name: 'Bo' }) }).click();
    await expect(page.getByRole('dialog', { name: t('buddies.remove.title', { name: 'Bo' }) })).toBeVisible();
    await expectAccessible(page, { include: [DIALOG] });
    await page
      .getByRole('dialog')
      .getByRole('button', { name: t('common.cancel') })
      .click();
    await main.getByRole('button', { name: t('buddies.link.replace') }).click();
    await expect(page.getByRole('dialog', { name: t('buddies.link.confirmTitle') })).toBeVisible();
    await expectAccessible(page, { include: [DIALOG] });
  });

  test('a buddy request: ask, and the other relations', async ({ page, shell, api, newApi, signedIn, uid }) => {
    const { adasLink } = await withBuddies(api, newApi, uid);
    await shell.open(`#/buddy/${adasLink}`);
    await shell.expectSignedIn(signedIn.displayName);
    await expect(page.getByRole('dialog', { name: t('buddies.request.ask', { name: 'Ada' }) })).toBeVisible();
    await expectAccessible(page, { include: [DIALOG] });
    // Her own link: only a statement.
    await page.evaluate((link) => (location.hash = link), `#/buddy/${await api.replaceBuddyLink()}`);
    await expect(page.getByRole('dialog').getByText(t('buddies.request.own'))).toBeVisible();
    await expectAccessible(page, { include: [DIALOG] });
    // An invalid link.
    await page.evaluate(() => (location.hash = '#/buddy/' + 'x'.repeat(43)));
    await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
    await expectAccessible(page, { include: [DIALOG] });
  });

  test('a club page with buddy controls in every state', async ({ page, shell, api, newApi, signedIn, uid }) => {
    const { club, token } = await api.clubWithInvite(`Sunday Clay ${uid}`);
    const me = (await api.me()).id;
    const members: Record<string, Api> = {};
    for (const name of ['Bo', 'Cy', 'Dee', 'Eli']) {
      members[name] = await newApi();
      await members[name].signUp(newAccount(uid, name));
      await members[name].joinClub(token);
    }
    await api.requestBuddyInClub(club.id, (await members.Bo.me()).id);
    await members.Bo.acceptBuddy(me);
    await api.requestBuddyInClub(club.id, (await members.Cy.me()).id);
    await members.Dee.requestBuddyInClub(club.id, me);
    await shell.open(`#/clubs/${club.id}`);
    await shell.expectSignedIn(signedIn.displayName);
    const main = page.getByRole('main');
    await expect(main.getByText(t('clubs.page.buddy.buddies'), { exact: true })).toBeVisible();
    await expect(main.getByText(t('clubs.page.buddy.sent'))).toBeVisible();
    await expect(main.getByText(t('clubs.page.buddy.asked'))).toBeVisible();
    await expect(main.getByRole('button', { name: t('clubs.page.buddy.askLabel', { name: 'Eli' }) })).toBeVisible();
    await settled(page);
    await expectAccessible(page);
  });

  test('the account menu with a buddy request', async ({ page, shell, api, newApi, signedIn, uid, isMobile }) => {
    test.skip(!isMobile, 'the account menu is a phone control; the wide header is covered by the account page');
    const mine = await api.replaceBuddyLink();
    const bo = await newApi();
    await bo.signUp(newAccount(uid, 'Bo'));
    await bo.requestBuddyByLink(mine);
    await shell.open('#/');
    await shell.expectSignedIn(signedIn.displayName);
    await shell.header.getByRole('button', { name: t('header.accountMenu', { name: signedIn.displayName }) }).click();
    await expect(shell.header.getByRole('link', { name: t('buddies.requestCount', { count: 1 }) })).toBeVisible();
    await expectAccessible(page);
  });

  test('change-password dialog', async ({ page, shell, signedIn }) => {
    await shell.open('#/account');
    await shell.expectSignedIn(signedIn.displayName);
    await new PasswordDialog(page).open();
    await expectAccessible(page, { include: [DIALOG] });
  });

  test('the feedback dialog with a photo, its details and, offline, its note', async ({ page, shell, context, signedIn }) => {
    await shell.open('#/stock');
    await shell.expectSignedIn(signedIn.displayName);
    const dialog = await shell.openFeedback();
    await dialog.getByRole('textbox', { name: t('feedback.message') }).fill('The scan sheet is great');
    await dialog.locator('input[type="file"]').setInputFiles([png('feedback.png')]);
    await expect(dialog.getByRole('img', { name: t('feedback.photo', { number: 1 }) })).toBeVisible();
    await expectAccessible(page, { include: [DIALOG] });
    await context.setOffline(true);
    await expect(dialog.getByText(t('feedback.offline'))).toBeVisible();
    await expectAccessible(page, { include: [DIALOG] });
    await context.setOffline(false);
  });

  test('the Feedback page for a site admin, its photo viewer and the deletion question', async ({ page, shell, signedIn, uid, encoder }) => {
    void encoder;
    await shell.open('#/');
    const dialog = await shell.openFeedback();
    await dialog.getByRole('textbox', { name: t('feedback.message') }).fill(`Feedback for the admins ${uid}`);
    await dialog.locator('input[type="file"]').setInputFiles([png('feedback.png')]);
    await expect(dialog.getByRole('img', { name: t('feedback.photo', { number: 1 }) })).toBeVisible();
    await dialog.getByRole('button', { name: t('feedback.send'), exact: true }).click();
    await expect(dialog).toBeHidden();
    await grantSiteAdmin(signedIn.email);
    await page.goto('about:blank');
    await shell.open('#/admin/feedback');
    const entry = page.locator('.feedback-admin__entry').filter({ hasText: uid });
    await expect(entry).toBeVisible();
    // Other entries' lazy thumbnails below the fold never load on a phone: wait for this entry's own photo.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await entry.locator('img').first().scrollIntoViewIfNeeded();
    await expect.poll(() => entry.locator('img').evaluateAll((images) => images.every((image) => (image as HTMLImageElement).complete))).toBe(true);
    await expectAccessible(page);
    await entry.getByRole('button', { name: t('feedbackAdmin.openPhoto', { number: 1, name: signedIn.displayName }) }).click();
    const viewer = page.getByRole('dialog', { name: t('feedbackAdmin.photoTitle', { number: 1, name: signedIn.displayName }) });
    await expect.poll(() => viewer.locator('img').evaluate((image: HTMLImageElement) => image.complete)).toBe(true);
    await expectAccessible(page, { include: [DIALOG] });
    await page.keyboard.press('Escape');
    await entry.getByRole('button', { name: new RegExp(`^${t('feedbackAdmin.delete')}`) }).click();
    await expect(page.getByRole('dialog', { name: t('feedbackAdmin.delete.title') })).toBeVisible();
    await expectAccessible(page, { include: [DIALOG] });
  });

  test('the Feedback page for a plain account', async ({ page, shell, signedIn }) => {
    await shell.open('#/admin/feedback');
    await shell.expectSignedIn(signedIn.displayName);
    await expect(page.getByText(t('feedbackAdmin.adminOnly'))).toBeVisible();
    await expectAccessible(page);
  });

  test('delete-account dialog', async ({ page, shell, signedIn }) => {
    await shell.open('#/account');
    await shell.expectSignedIn(signedIn.displayName);
    await new AccountPage(page).deleteAccount.click();
    await expect(page.getByRole('dialog', { name: t('account.delete.title') })).toBeVisible();
    await expectAccessible(page, { include: [DIALOG] });
  });

  test('add-glaze dialog', async ({ page, shell, signedIn }) => {
    await shell.open();
    await shell.expectSignedIn(signedIn.displayName);
    await new AddGlazeDialog(page).openFromExplore();
    const add = new AddGlazeDialog(page);
    await expect(add.dialog).toBeVisible();
    await expectAccessible(page, { include: [DIALOG] });
    await add.dialog.getByRole('button', { name: t('glazeForm.addManufacturer') }).click();
    await expect(add.field('glazeForm.shortId')).toBeVisible();
    await expectAccessible(page, { include: [DIALOG] });
  });

  test('upload dialog', async ({ page, shell, api, signedIn, uid }) => {
    const id = await api.addCombination({ title: `Upload ${uid}`, steps: [BISQUE_STEP] });
    await shell.open(`#/combinations/${id}`);
    await shell.expectSignedIn(signedIn.displayName);
    await page
      .getByRole('main')
      .getByRole('button', { name: t('images.addTestTile') })
      .first()
      .click();
    await expect(page.getByRole('dialog', { name: t('upload.heading', { title: `Upload ${uid}` }) })).toBeVisible();
    await expectAccessible(page, { include: [DIALOG] });
  });

  test('upload dialog with a focused photo, and the focus dialog after a key', async ({ page, shell, api, signedIn, uid }) => {
    const title = `Focus ${uid}`;
    const id = await api.addCombination({ title, steps: [BISQUE_STEP] });
    await shell.open(`#/combinations/${id}`);
    await shell.expectSignedIn(signedIn.displayName);
    await page
      .getByRole('main')
      .getByRole('button', { name: t('images.addTestTile') })
      .first()
      .click();
    const upload = page.getByRole('dialog', { name: t('upload.heading', { title }) });
    await upload.getByLabel(t('upload.library')).setInputFiles(photoPng('kiln.png', 480, 360));
    await upload.getByRole('button', { name: t('upload.focus.openNamed', { name: 'kiln.png' }) }).click();
    const focus = page.getByRole('dialog', { name: t('upload.focus.title') });
    await expect(focus.getByRole('button', { name: t('upload.focus.stage', { name: 'kiln.png' }) })).not.toHaveAttribute('aria-busy', 'true');
    await page.keyboard.press('ArrowDown');
    await expect(focus.getByRole('status')).not.toBeEmpty();
    await expectAccessible(page, { include: [DIALOG] });
    await focus.getByRole('button', { name: t('upload.focus.save') }).click();
    await expect(upload.getByRole('button', { name: t('upload.focus.resetNamed', { name: 'kiln.png' }) })).toBeVisible();
    await expectAccessible(page, { include: [DIALOG] });
  });

  /** The stand-in model files (a red photo is a mug): the real worker and runtime run, nothing large is downloaded. */
  async function standInVision(page: Page) {
    const files = standInFiles();
    await page.route(VISION_URL, (route) => {
      const model = route.request().url().endsWith('model.onnx');
      return route.fulfill({ status: 200, contentType: model ? 'application/octet-stream' : 'application/json', body: model ? files.model : files.labels });
    });
  }

  test('upload dialog asking about the photo suggestions, and with suggested tags', async ({ page, shell, api, signedIn, uid }) => {
    await standInVision(page);
    const title = `Upload suggestions ${uid}`;
    const id = await api.addCombination({ title, steps: [BISQUE_STEP] });
    await shell.open(`#/combinations/${id}`);
    await shell.expectSignedIn(signedIn.displayName);
    await page
      .getByRole('main')
      .getByRole('button', { name: t('images.addFinished') })
      .first()
      .click();
    const upload = page.getByRole('dialog', { name: t('upload.heading', { title }) });
    await upload.getByLabel(t('upload.library')).setInputFiles(png('red.png', [230, 10, 10], 96, 96));
    await expect(upload.getByRole('heading', { level: 3, name: t('vision.consent.title') })).toBeVisible();
    await expectAccessible(page, { include: [DIALOG] });
    await upload.getByRole('button', { name: t('vision.consent.on') }).click();
    await expect(upload.getByRole('button', { name: t('vision.suggested.add', { tag: 'mug' }) })).toBeVisible();
    await expectAccessible(page, { include: [DIALOG] });
    await upload.getByRole('button', { name: t('vision.suggested.add', { tag: 'mug' }) }).click();
    await expect(upload.getByRole('status').filter({ hasText: t('vision.suggested.added', { tag: 'mug' }) })).toBeVisible();
    await expectAccessible(page, { include: [DIALOG] });
  });

  test('the account page photo suggestions setting, off and on', async ({ page, shell, signedIn }) => {
    await standInVision(page);
    await shell.open('#/account');
    await shell.expectSignedIn(signedIn.displayName);
    const section = page.getByRole('heading', { level: 2, name: t('vision.setting.title'), exact: true });
    await expect(section).toBeVisible();
    await page.getByText(t('vision.setting.review'), { exact: true }).click();
    await expect(page.getByRole('button', { name: t('vision.consent.on') })).toBeVisible();
    await expectAccessible(page);
    await page.getByRole('button', { name: t('vision.consent.on') }).click();
    await expect(page.getByRole('button', { name: t('vision.remove') })).toBeVisible();
    await expectAccessible(page);
  });

  test('the similar looks: the question, the progress and the results on a page, in the photo viewer and in the upload dialog', async ({
    page,
    shell,
    api,
    signedIn,
    uid,
  }) => {
    const library = await seedSimilar(api, uid);
    await standInVision(page);
    await page.addInitScript(() => localStorage.setItem('glazelab:photo-suggestions', 'on'));
    await shell.open(`#/glazes/${library.glaze.red}`);
    await shell.expectSignedIn(signedIn.displayName);
    const similar = page.getByRole('main').getByRole('region', { name: t('similar.title'), exact: true });
    await expect(similar.getByRole('heading', { level: 3, name: t('similar.consent.title') })).toBeVisible();
    await expectAccessible(page);
    await similar.getByRole('button', { name: t('similar.consent.index') }).click();
    await expect(similar.getByRole('heading', { level: 3, name: t('similar.group.tile') })).toBeVisible({ timeout: 120_000 });
    await expect.poll(() => page.evaluate(() => [...document.images].every((image) => image.complete))).toBe(true);
    await expectAccessible(page);

    // The photo viewer's panel, on its dark ground.
    await page
      .getByRole('main')
      .getByRole('group', { name: t('images.viewer.open') })
      .click();
    const viewer = page.getByRole('dialog');
    await viewer.getByRole('button', { name: t('similar.find') }).click();
    await expect(viewer.getByRole('link').first()).toBeVisible();
    await expect.poll(() => page.evaluate(() => [...document.images].every((image) => image.complete))).toBe(true);
    await expectAccessible(page, { include: [DIALOG] });
    await page.keyboard.press('Escape');

    // The upload dialog's search for a fresh photo.
    await shell.open(`#/combinations/${library.combination.z}`);
    await page
      .getByRole('main')
      .getByRole('button', { name: t('images.addTestTile') })
      .first()
      .click();
    const upload = page.getByRole('dialog');
    await upload.getByLabel(t('upload.library')).setInputFiles(png('fresh.png', [198, 118, 33], 96, 96));
    await upload.getByRole('button', { name: t('similar.upload.find', { name: 'fresh.png' }) }).click();
    await expect(upload.getByRole('link').first()).toBeVisible();
    await expect.poll(() => page.evaluate(() => [...document.images].every((image) => image.complete))).toBe(true);
    await expectAccessible(page, { include: [DIALOG] });
  });

  test('the account page similar looks setting: needs the model, the question, the progress and the indexed state', async ({
    page,
    shell,
    api,
    signedIn,
    uid,
  }) => {
    await seedSimilar(api, uid);
    await standInVision(page);
    await shell.open('#/account');
    await shell.expectSignedIn(signedIn.displayName);
    await expect(page.getByText(t('similar.setting.needsModel'))).toBeVisible();
    await expectAccessible(page);
    await page.evaluate(() => localStorage.setItem('glazelab:photo-suggestions', 'on'));
    await page.reload();
    await shell.expectSignedIn(signedIn.displayName);
    await expect(page.getByRole('button', { name: t('similar.consent.index') })).toBeVisible();
    await expectAccessible(page);
    await page.getByRole('button', { name: t('similar.consent.index') }).click();
    await expect(page.getByRole('button', { name: t('similar.setting.remove') })).toBeVisible({ timeout: 120_000 });
    await expectAccessible(page);
  });

  test('upload dialog with a HEIC photo this browser cannot convert', async ({ page, shell, api, signedIn, uid }) => {
    const title = `Upload HEIC ${uid}`;
    const id = await api.addCombination({ title, steps: [BISQUE_STEP] });
    await shell.open(`#/combinations/${id}`);
    await shell.expectSignedIn(signedIn.displayName);
    await page
      .getByRole('main')
      .getByRole('button', { name: t('images.addTestTile') })
      .first()
      .click();
    const upload = page.getByRole('dialog', { name: t('upload.heading', { title }) });
    // Headless Chromium cannot decode HEIC, so the message is the real one.
    await upload.getByLabel(t('upload.library')).setInputFiles({ name: 'IMG_0001.HEIC', mimeType: 'image/heic', buffer: Buffer.from('not an image') });
    await expect(upload.getByRole('alert')).toContainText(t('upload.reason.heic'));
    await expectAccessible(page, { include: [DIALOG] });
  });

  for (const [name, entry] of [
    ['photo-details dialog', 'images.menu.details'],
    ['photo-type dialog', 'images.menu.kind'],
    ['photo-focus dialog', 'images.menu.focus'],
    ['photo-visibility dialog', 'images.menu.visibility'],
    ['photo-delete dialog', 'images.menu.delete'],
  ] as const) {
    test(name, async ({ page, shell, api, signedIn, uid }) => {
      const id = await api.addCombination({ title: `Photo ${uid}`, steps: [BISQUE_STEP] });
      await api.uploadToCombination(id, { file: photoPng('tile.png', 480, 360) });
      await shell.open(`#/combinations/${id}`);
      await shell.expectSignedIn(signedIn.displayName);
      await page.getByRole('button', { name: t('images.menu.label') }).click();
      await page.getByRole('menuitem', { name: t(entry) }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expectAccessible(page, { include: [DIALOG] });
    });
  }

  test('photo viewer with four photos, the second one shown', async ({ page, shell, api, signedIn, uid }) => {
    const title = `Viewer ${uid}`;
    const id = await api.addCombination({ title, steps: [BISQUE_STEP] });
    for (const kind of ['TEST_TILE', 'FINISHED', 'FINISHED', 'TEST_TILE'] as const) {
      await api.uploadToCombination(id, { file: photoPng('tile.png', 1200, 900), kind, caption: 'Two coats', firedOn: '2026-10-18' });
    }
    await shell.open(`#/combinations/${id}`);
    await shell.expectSignedIn(signedIn.displayName);
    await page.getByRole('group', { name: t('images.galleryNavigation') }).click();
    const viewer = page.getByRole('dialog', { name: t('images.viewer.label', { title }) });
    await expect(viewer).toBeVisible();
    await viewer.getByRole('button', { name: t('images.viewer.next') }).click();
    await expect(viewer.getByText('2 / 4', { exact: true })).toBeVisible();
    await expect.poll(() => viewer.evaluate((element) => [...element.querySelectorAll('img')].every((image) => image.complete))).toBe(true);
    await expectAccessible(page, { include: [DIALOG] });
  });

  test('photo viewer on a phone on its side, with the text beside the photo', async ({ page, shell, api, signedIn, uid }) => {
    const title = `Viewer side ${uid}`;
    const id = await api.addCombination({ title, steps: [BISQUE_STEP] });
    for (const kind of ['TEST_TILE', 'FINISHED'] as const) {
      await api.uploadToCombination(id, { file: photoPng('tile.png', 1200, 900), kind, caption: 'Two coats', firedOn: '2026-10-18' });
    }
    await shell.open(`#/combinations/${id}`);
    await shell.expectSignedIn(signedIn.displayName);
    await page.setViewportSize({ width: 844, height: 390 });
    await page.getByRole('group', { name: t('images.galleryNavigation') }).click();
    const viewer = page.getByRole('dialog', { name: t('images.viewer.label', { title }) });
    await expect(viewer).toBeVisible();
    await expect.poll(() => viewer.evaluate((element) => [...element.querySelectorAll('img')].every((image) => image.complete))).toBe(true);
    await expectAccessible(page, { include: [DIALOG] });
  });

  test('photo viewer with one photo', async ({ page, shell, api, signedIn, uid }) => {
    const title = `Viewer one ${uid}`;
    const id = await api.addCombination({ title, steps: [BISQUE_STEP] });
    await api.uploadToCombination(id, {
      file: photoPng('tile.png', 1200, 900),
      caption: 'A longer caption that wraps over several lines on a phone, like a note about the firing.',
    });
    await shell.open(`#/combinations/${id}`);
    await shell.expectSignedIn(signedIn.displayName);
    await page.getByRole('group', { name: t('images.viewer.open') }).click();
    const viewer = page.getByRole('dialog', { name: t('images.viewer.label', { title }) });
    await expect(viewer).toBeVisible();
    await expect.poll(() => viewer.evaluate((element) => [...element.querySelectorAll('img')].every((image) => image.complete))).toBe(true);
    await expectAccessible(page, { include: [DIALOG] });
  });

  test('photo-report dialog', async ({ page, shell, library, signedIn }) => {
    await shell.open(`#/combinations/${celadon(library)}`);
    await shell.expectSignedIn(signedIn.displayName);
    await page.getByRole('button', { name: t('images.menu.report') }).click();
    await expect(page.getByRole('dialog', { name: t('images.report.title') })).toBeVisible();
    await expectAccessible(page, { include: [DIALOG] });
  });

  test('a club page with members’ pictures, the profile-picture menu and its report dialog', async ({ page, shell, api, newApi, signedIn, uid }) => {
    const ben = await newApi();
    await ben.signUp(newAccount(uid, 'Ben'));
    await ben.uploadAvatar(seededPicture(`${uid}-a11y-Ben`));
    const { club, token } = await ben.clubWithInvite(`Sunday Clay ${uid}`);
    await api.joinClub(token);
    await shell.open(`#/clubs/${club.id}`);
    await shell.expectSignedIn(signedIn.displayName);
    const row = page.getByRole('main').getByRole('listitem').filter({ hasText: 'Ben' });
    await row.scrollIntoViewIfNeeded();
    await expect(row.locator('img[src^="blob:"]')).toHaveCount(1);
    await settled(page);
    await expectAccessible(page);
    await row.getByRole('button', { name: t('avatar.report.menu', { name: 'Ben' }) }).click();
    await expect(page.getByRole('menuitem', { name: t('avatar.report.entry') })).toBeVisible();
    await expectAccessible(page);
    await page.getByRole('menuitem', { name: t('avatar.report.entry') }).click();
    await expect(page.getByRole('dialog', { name: t('avatar.report.title') })).toBeVisible();
    await expectAccessible(page, { include: [DIALOG] });
  });

  test('a combination of a member with a picture: its card, and the page with the report menu open', async ({ page, shell, newApi, signedIn, uid }) => {
    const ben = await newApi();
    await ben.signUp(newAccount(uid, 'Ben'));
    await ben.uploadAvatar(seededPicture(`${uid}-a11y-card`));
    const id = await ben.addCombination({ title: `Pictured ${uid}`, steps: [BISQUE_STEP] });
    await shell.open(`#/?type=combinations&q=Pictured ${uid}`);
    await shell.expectSignedIn(signedIn.displayName);
    const card = page.getByRole('main').getByRole('article');
    await expect(card.locator('img[src^="blob:"]')).toHaveCount(1);
    await settled(page);
    await expectAccessible(page);
    await shell.open(`#/combinations/${id}`);
    await page.getByRole('button', { name: t('avatar.report.menu', { name: 'Ben' }) }).click();
    await expect(page.getByRole('menuitem', { name: t('avatar.report.entry') })).toBeVisible();
    await settled(page);
    await expectAccessible(page);
  });

  test('the Buddies section and the request page with profile pictures', async ({ page, shell, api, newApi, signedIn, uid }) => {
    const { adasLink } = await withBuddies(api, newApi, uid);
    const ada = await newApi();
    await ada.signUp(newAccount(uid, 'Ada2'));
    await ada.uploadAvatar(seededPicture(`${uid}-a11y-Ada`));
    const link = await ada.replaceBuddyLink();
    await shell.open('#/account');
    await shell.expectSignedIn(signedIn.displayName);
    await expect(page.getByRole('main').getByRole('listitem').filter({ hasText: 'Cy' })).toBeVisible();
    await settled(page);
    await expectAccessible(page);
    await page.evaluate((hash) => (location.hash = hash), `#/buddy/${link}`);
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('img[src^="blob:"]')).toHaveCount(1);
    await expectAccessible(page, { include: [DIALOG] });
    await dialog.getByRole('button', { name: t('avatar.report.menu', { name: 'Ada2' }) }).click();
    await expect(page.getByRole('menuitem', { name: t('avatar.report.entry') })).toBeVisible();
    await expectAccessible(page, { include: [DIALOG] });
    void adasLink;
  });

  test('the discard question of the add-glaze dialog', async ({ page, shell, signedIn }) => {
    await shell.open();
    await shell.expectSignedIn(signedIn.displayName);
    await new AddGlazeDialog(page).openFromExplore();
    const add = new AddGlazeDialog(page);
    await add.field('stock.newGlaze.name').fill('Draft');
    await add.close();
    await expect(add.discardQuestion).toBeVisible();
    await expectAccessible(page, { include: [DIALOG] });
  });

  test('glaze edit and history dialogs', async ({ page, shell, library, signedIn }) => {
    await shell.open(`#/glazes/${glazeId(library)}`);
    await shell.expectSignedIn(signedIn.displayName);
    await page.getByRole('button', { name: t('glaze.details.editLabel') }).click();
    await expect(page.getByRole('dialog', { name: t('glaze.edit.title') })).toBeVisible();
    await expectAccessible(page, { include: [DIALOG] });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: t('glaze.details.history') }).click();
    await expect(page.getByRole('dialog', { name: t('glaze.history.title') })).toBeVisible();
    await expectAccessible(page, { include: [DIALOG] });
  });

  test("the rename dialog of the author and a site admin's title correction", async ({ page, shell, api, newApi, signedIn, uid }) => {
    const own = await api.addCombination({ title: `Mine ${uid}`, steps: [BISQUE_STEP] });
    const author = await newApi();
    await author.signUp(newAccount(uid, 'Cleo'));
    const theirs = await author.addCombination({ title: `Theirs ${uid}`, steps: [BISQUE_STEP] });
    await shell.open(`#/combinations/${own}`);
    await shell.expectSignedIn(signedIn.displayName);
    await page
      .getByRole('main')
      .getByRole('button', { name: t('combination.rename'), exact: true })
      .click();
    await expect(page.getByRole('dialog', { name: t('combination.rename.title') })).toBeVisible();
    await expectAccessible(page, { include: [DIALOG] });
    await page.keyboard.press('Escape');
    await grantSiteAdmin(signedIn.email);
    await page.goto('about:blank');
    await shell.open(`#/combinations/${theirs}`);
    await page
      .getByRole('main')
      .getByRole('button', { name: t('combination.correctTitle'), exact: true })
      .click();
    await expect(page.getByRole('dialog', { name: t('combination.correctTitle') })).toBeVisible();
    await expectAccessible(page, { include: [DIALOG] });
  });

  test('account menu on a phone', async ({ page, shell, signedIn, isMobile }) => {
    test.skip(!isMobile, 'the account menu is a phone control');
    await shell.open();
    await shell.expectSignedIn(signedIn.displayName);
    await shell.header.getByRole('button', { name: t('header.accountMenu', { name: signedIn.displayName }) }).click();
    await expect(shell.header.getByRole('button', { name: t('header.signOut') })).toBeVisible();
    await expectAccessible(page);
  });
});

test.describe('with a mocked API', () => {
  test('the offline icon and its toast', async ({ page, shell }) => {
    // A device that reports itself offline warns at once (`offline.spec.ts`).
    await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', { get: () => false }));
    await mockApi(page);
    await page.route('**/api/**', (route) => route.abort('connectionrefused'));
    await page.goto('/#/');
    const icon = shell.header.getByRole('button', { name: t('header.offline') });
    await expect(icon).toBeVisible();
    await settled(page);
    await expectAccessible(page);
    await icon.click();
    await expect(page.getByRole('status').getByText(t('app.offlineToast'))).toBeVisible();
    await expectAccessible(page);
  });

  test('the error toast with Try again and Dismiss', async ({ page, shell }) => {
    let failing = false;
    await mockApi(page, {
      answers: {
        'GET /api/glazes': async (route) =>
          failing ? route.fulfill({ status: 429, json: { error: 'Too many requests. Please wait a moment and try again.' } }) : route.fulfill({ json: [] }),
      },
    });
    await shell.open('#/account');
    await shell.expectSignedIn(MOCK_USER.displayName);
    await page.waitForLoadState('networkidle');
    failing = true;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    const toast = page.getByRole('alert');
    await expect(toast.getByText(t('errors.tooManyRequests'))).toBeVisible();
    await expect(toast.getByRole('button', { name: t('common.tryAgain') })).toBeVisible();
    await expect(toast.getByRole('button', { name: t('app.dismissError') })).toBeVisible();
    await settled(page);
    await expectAccessible(page);
  });

  test('the signed-in header while the connection is lost, with the toast open and (phones) the account menu open', async ({
    page,
    shell,
    context,
    isMobile,
  }) => {
    await mockApi(page);
    await shell.open();
    await shell.expectSignedIn(MOCK_USER.displayName);
    await page.waitForLoadState('networkidle');
    await context.setOffline(true);
    const icon = shell.header.getByRole('button', { name: t('header.offline') });
    await expect(icon).toBeVisible();
    await settled(page);
    await expectAccessible(page);
    await icon.click();
    await expect(page.getByText(t('app.offlineToast'))).toBeVisible();
    await expectAccessible(page);
    if (isMobile) {
      await shell.header.getByRole('button', { name: t('header.accountMenu', { name: MOCK_USER.displayName }) }).click();
      await expect(shell.header.getByRole('link', { name: t('account.page.title') })).toBeVisible();
      await expectAccessible(page);
    }
  });

  test('the header while the Back online text is in its status region', async ({ page, shell, context }) => {
    await mockApi(page);
    await shell.open();
    await shell.expectSignedIn(MOCK_USER.displayName);
    await page.waitForLoadState('networkidle');
    await context.setOffline(true);
    await expect(shell.header.getByRole('status').getByText(t('header.offline'), { exact: true })).toBeAttached();
    await context.setOffline(false);
    await expect(shell.header.getByRole('status')).toHaveText(t('header.backOnline'));
    await expectAccessible(page);
  });

  test('the password recovery step of the sign-in dialog', async ({ page, shell }) => {
    // Recovery needs a server that sends mail.
    await mockApi(page, { user: null, answers: { 'GET /api/auth/options': { json: { emailEnabled: true, termsVersion } } } });
    await shell.open();
    await shell.signInButton().click();
    const dialog = page.getByRole('dialog', { name: t('auth.dialogLabel') });
    await dialog.getByRole('button', { name: t('auth.forgotPassword') }).click();
    await expect(dialog.getByRole('button', { name: t('auth.forgotPassword') })).toBeHidden();
    await expectAccessible(page, { include: [DIALOG] });
  });

  test('the blocking terms dialog', async ({ page }) => {
    await mockApi(page, { user: { ...MOCK_USER, acceptedTermsVersion: null } });
    await page.goto('/#/');
    await expect(page.getByRole('dialog', { name: t('terms.update.title') })).toBeVisible();
    await expectAccessible(page, { include: [DIALOG] });
  });

  test('the image deletion log for a site admin', async ({ page }) => {
    await mockApi(page, {
      user: { ...MOCK_USER, siteAdmin: true },
      answers: {
        'GET /api/admin/image-deletions': {
          json: {
            hasMore: false,
            entries: [
              {
                imageId: '00000000-0000-4000-8000-0000000000a1',
                title: 'Celadon over Shino White',
                combinationId: '00000000-0000-4000-8000-0000000000b1',
                glazeId: null,
                uploaderId: MOCK_USER.id,
                deletedBy: MOCK_USER.id,
                deletedAt: '2026-10-01T10:00:00Z',
                visibility: 'PUBLIC',
              },
            ],
          },
        },
      },
    });
    await page.goto('/#/admin/image-deletions');
    await expect(page.getByRole('main').getByText('Celadon over Shino White')).toBeVisible();
    await settled(page);
    await expectAccessible(page);
  });

  test('the image report queue for a site admin', async ({ page }) => {
    await mockApi(page, {
      user: { ...MOCK_USER, siteAdmin: true },
      answers: {
        'GET /api/admin/image-reports': {
          json: {
            hasMore: false,
            entries: [
              {
                id: '00000000-0000-4000-8000-0000000000c1',
                imageId: '00000000-0000-4000-8000-0000000000a1',
                title: 'Celadon over Shino White',
                combinationId: '00000000-0000-4000-8000-0000000000b1',
                glazeId: null,
                reporter: 'Mara Lindqvist',
                reason: 'Not a glaze test',
                visibility: 'CLUB',
                createdAt: '2026-10-01T10:00:00Z',
                uploaderId: '00000000-0000-4000-8000-0000000000d1',
                uploader: 'Ines Duarte',
              },
            ],
          },
        },
      },
    });
    await page.goto('/#/admin/image-reports');
    await expect(page.getByRole('main').getByText('Not a glaze test')).toBeVisible();
    await settled(page);
    await expectAccessible(page);
  });
});

test.describe('the profile-picture report queue', () => {
  test('for a site admin, with its filter, and the removal question', async ({ page }) => {
    await mockAvatarQueue(page);
    await page.goto('/#/admin/avatar-reports');
    await expect(page.getByRole('main').getByText('Shows my neighbour')).toBeVisible();
    await loadQueuePictures(page);
    await settled(page);
    await expectAccessible(page);
    await page
      .getByRole('main')
      .getByRole('button', { name: new RegExp(`^${t('avatars.reports.remove')}`) })
      .first()
      .click();
    await expect(page.getByRole('dialog', { name: t('avatars.reports.confirm.remove') })).toBeVisible();
    await expectAccessible(page, { include: [DIALOG] });
  });

  test('is for site admins only', async ({ page }) => {
    await mockApi(page);
    await page.goto('/#/admin/avatar-reports');
    await expect(page.getByRole('main').getByText(t('avatars.reports.adminOnly'))).toBeVisible();
    await expectAccessible(page);
  });
});

test.describe('banning accounts', () => {
  test('the ban dialog from the profile-picture queue, with its reason missing', async ({ page }) => {
    await mockAvatarQueue(page);
    await page.goto('/#/admin/avatar-reports');
    await expect(page.getByRole('main').getByText('Shows my neighbour')).toBeVisible();
    await loadQueuePictures(page);
    await page
      .getByRole('main')
      .getByRole('button', { name: new RegExp(`^${t('ban.entry')}`) })
      .first()
      .click();
    const dialog = page.getByRole('dialog', { name: t('ban.title', { name: 'Cleo Marsh' }) });
    await expect(dialog.getByRole('checkbox', { name: t('ban.blockPictures') })).toBeVisible();
    await expectAccessible(page, { include: [DIALOG] });
    // A blank reason (the browser stops an empty one at its own message).
    await dialog.getByRole('textbox', { name: t('ban.reason') }).fill('   ');
    await dialog.getByRole('button', { name: t('ban.submit') }).click();
    await expect(dialog.getByText(t('ban.reasonRequired'))).toBeVisible();
    await expectAccessible(page, { include: [DIALOG] });
  });

  test('the Bans page for a site admin, and the question before lifting one', async ({ page }) => {
    await mockApi(page, { user: { ...MOCK_USER, siteAdmin: true }, answers: { 'GET /api/admin/bans': { json: BANS } } });
    await page.goto('/#/admin/bans');
    await expect(page.getByRole('main').getByText('Harassment of club members.')).toBeVisible();
    await settled(page);
    await expectAccessible(page);
    await page
      .getByRole('main')
      .locator('.bans__entry')
      .filter({ hasText: 'Harassment of club members.' })
      .getByRole('button', { name: new RegExp(`^${t('bans.lift')}: `) })
      .click();
    await expect(page.getByRole('dialog', { name: t('bans.lift.title') })).toBeVisible();
    await expectAccessible(page, { include: [DIALOG] });
  });

  test('the Administration landing page for a site admin', async ({ page }) => {
    await mockApi(page, { user: { ...MOCK_USER, siteAdmin: true } });
    await page.goto('/#/admin');
    await expect(page.getByRole('main').getByRole('link', { name: t('bans.title') })).toBeVisible();
    await settled(page);
    await expectAccessible(page);
  });

  test('the Administration landing page for a plain account', async ({ page }) => {
    await mockApi(page);
    await page.goto('/#/admin');
    await expect(page.getByRole('main').getByText(t('admin.adminOnly'))).toBeVisible();
    await expectAccessible(page);
  });

  test('the Bans page for a plain account', async ({ page }) => {
    await mockApi(page);
    await page.goto('/#/admin/bans');
    await expect(page.getByRole('main').getByText(t('bans.adminOnly'))).toBeVisible();
    await expectAccessible(page);
  });

  test('the Bans page with an empty list', async ({ page }) => {
    await mockApi(page, { user: { ...MOCK_USER, siteAdmin: true }, answers: { 'GET /api/admin/bans': { json: { entries: [], hasMore: false } } } });
    await page.goto('/#/admin/bans');
    await expect(page.getByRole('main').getByText(t('bans.empty'))).toBeVisible();
    await expectAccessible(page);
  });

  test('the Error reports page: the list, the open details and the deletion question', async ({ page }) => {
    await mockErrorReports(page);
    await openErrorReports(page);
  });

  test('the Error reports page with an empty list', async ({ page }) => {
    await mockErrorReports(page, { groups: [], hasMore: false });
    await page.goto('/#/admin/error-reports');
    await expect(page.getByRole('main').getByText(t('errorReports.empty'))).toBeVisible();
    await expectAccessible(page);
  });

  test('the Error reports page for a plain account', async ({ page }) => {
    await mockApi(page);
    await page.goto('/#/admin/error-reports');
    await expect(page.getByRole('main').getByText(t('errorReports.adminOnly'))).toBeVisible();
    await expectAccessible(page);
  });

  test('a club page for a site admin: the admin menu on a member and the ban dialog', async ({ page, shell, api, newApi, signedIn, uid }) => {
    const ben = await newApi();
    await ben.signUp(newAccount(uid, 'Ben'));
    const { club, token } = await ben.clubWithInvite(`Ban a11y ${uid}`);
    await api.joinClub(token);
    await grantSiteAdmin(signedIn.email);
    await shell.open(`#/clubs/${club.id}`);
    const row = page.getByRole('main').getByRole('listitem').filter({ hasText: 'Ben' });
    await row.scrollIntoViewIfNeeded();
    await settled(page);
    await expectAccessible(page);
    await row.getByRole('button', { name: t('member.menu', { name: 'Ben' }) }).click();
    await expect(page.getByRole('menuitem', { name: t('ban.entry') })).toBeVisible();
    await expectAccessible(page);
    await page.getByRole('menuitem', { name: t('ban.entry') }).click();
    await expect(page.getByRole('dialog', { name: t('ban.title', { name: 'Ben' }) })).toBeVisible();
    await expectAccessible(page, { include: [DIALOG] });
  });
});

// A server of its own: its origin gets its own service worker, whose next version the notice announces (as `update.spec.ts`).
test.describe('the update notice', () => {
  test.use({ serviceWorkers: 'allow' });

  test('is announced on a page', async ({ page }) => {
    const apiUrl = process.env.GLAZELAB_E2E_API_URL;
    if (!apiUrl) throw new Error('GLAZELAB_E2E_API_URL is unset');
    const server = await startWebServer({ dist: DIST, apiUrl });
    try {
      await page.goto(server.url + '/#/');
      await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
      server.setServiceWorkerSuffix('next version');
      await page.reload();
      await expect(page.getByRole('status').locator('.update-notice')).toBeVisible();
      await settled(page);
      await expectAccessible(page);
      // With an error toast above it (the polite update toast and the assertive error toast together).
      await page.route('**/api/auth/me', (route) => route.fulfill({ status: 429, json: { error: 'Too many requests. Please wait a moment and try again.' } }));
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      await expect(page.locator('.app-shell__toast--error')).toBeVisible();
      await settled(page);
      await expectAccessible(page);
    } finally {
      await server.close();
    }
  });
});

// The rules axe applies do not depend on the language, but accessible names do: a guest walk, one signed-in dialog and one admin page
// once more in every other language. The other pages are English only; their names are checked in every dictionary by Vitest
// (`lib/i18n/accessible-names.test.ts`, `i18n.test.ts`) and long words by `overflow.spec.ts` (frontend guide "Accessibility").
for (const locale of translated) {
  test.describe(`in ${locale}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((value) => localStorage.setItem('glazelab:locale', value), locale);
    });

    test('Explore, a combination and a glaze as a guest', async ({ page, library }) => {
      await page.goto(`/#/?q=${library.naming.uid}`);
      await expect(page.getByRole('main').getByRole('article').first()).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await settled(page);
      await expectAccessible(page);
      await page.goto(`/#/combinations/${celadon(library)}`);
      await expect(page.getByRole('main').getByRole('img').first()).toBeVisible();
      await settled(page);
      await expectAccessible(page);
      await page.goto(`/#/glazes/${glazeId(library)}`);
      await settled(page);
      await expectAccessible(page);
    });

    test('the feedback dialog with a photo, signed in', async ({ page, isMobile, signedIn }) => {
      await page.goto('/#/stock');
      const header = page.getByRole('banner');
      if (isMobile) await header.getByRole('button', { name: anyLanguage('header.accountMenu', { name: signedIn.displayName }, true) }).click();
      await header.getByRole('button', { name: anyLanguage('feedback.open', {}, true) }).click();
      const dialog = page.getByRole('dialog', { name: dictionaries[locale]['feedback.title'] });
      await dialog.getByRole('textbox', { name: dictionaries[locale]['feedback.message'] }).fill('The scan sheet is great');
      await dialog.locator('input[type="file"]').setInputFiles([png('feedback.png')]);
      await expect(dialog.getByRole('img', { name: dictionaries[locale]['feedback.photo'].replace('{number}', '1') })).toBeVisible();
      await expectAccessible(page, { include: [DIALOG] });
    });

    test('the Administration landing page', async ({ page }) => {
      await mockApi(page, { user: { ...MOCK_USER, siteAdmin: true } });
      await page.goto('/#/admin');
      await expect(page.getByRole('main').getByRole('list').getByRole('link')).toHaveCount(7);
      await settled(page);
      await expectAccessible(page);
    });
  });
}

test.describe('the helper', () => {
  const failureOf = (page: Page, html: string, options?: Parameters<typeof expectAccessible>[1]) =>
    page
      .setContent(`<!doctype html><html lang="en"><head><title>x</title></head><body><main><h1>x</h1>${html}</main></body></html>`)
      .then(() => expectAccessible(page, options))
      .then(
        () => '',
        (error: Error) => error.message,
      );

  test('reports a violation with its rule, selector and help link', async ({ page }) => {
    const failure = await failureOf(page, '<img src="data:," id="bad">');
    expect(failure).toContain('image-alt (critical)');
    expect(failure).toContain('#bad');
    expect(failure).toContain('https://dequeuniversity.com/rules/axe/');
  });

  test('measures contrast', async ({ page }) => {
    expect(await failureOf(page, '<p style="color:#999;background:#fff">pale</p>')).toContain('color-contrast');
  });

  test('checks only what `include` names, and skips a rule named in `skip`', async ({ page }) => {
    const html = '<div role="dialog" aria-label="d"><p>fine</p></div><img src="data:,">';
    expect(await failureOf(page, html, { include: [DIALOG] })).toBe('');
    expect(await failureOf(page, html)).toContain('image-alt');
    expect(await failureOf(page, html, { skip: [{ rule: 'image-alt', reason: 'a test of the helper' }] })).toBe('');
  });
});
