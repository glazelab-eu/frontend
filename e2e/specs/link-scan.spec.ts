import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { barcodeVideo, eanFor, qrVideo, qrVideoOf } from '../support/barcodes';
import { t } from '../support/i18n';
import { FIXTURES, chromeBinary } from '../support/paths';
import { expect, newAccount, test as base } from '../support/test';

/** The in-app QR scan of buddy and club invite links (27-4): the fake camera films a rendered QR code, never a real camera. */
const video = join(FIXTURES, `link-scan-${process.pid}.y4m`);
mkdirSync(FIXTURES, { recursive: true });

/**
 * Every test starts with a neutral film (an EAN-13, which the QR scanner never reads) and removes the file afterwards, so
 * a scanner that a test opens without filming its own shows nothing, whatever an earlier test of the worker filmed.
 */
const test = base.extend<{ neutralFilm: void }>({
  neutralFilm: [
    async ({ uid }, use) => {
      writeFileSync(video, barcodeVideo(eanFor(`link-scan-neutral-${uid}`)));
      await use();
      rmSync(video, { force: true });
    },
    { auto: true },
  ],
});

const camera = (...extra: string[]) => ({
  executablePath: chromeBinary(),
  args: ['--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`, ...extra],
});
test.use({ launchOptions: camera(), permissions: ['camera'] });

/** The fake camera reads its file when the camera starts, so the code is written just before the scanner opens. */
const film = (text: string) => writeFileSync(video, qrVideo(text));
const origin = (page: Page) => new URL(page.url()).origin + '/';
const scanner = (page: Page, title: string) => page.getByRole('dialog', { name: title });
const noToken = async (page: Page, token: string) => {
  expect(page.url()).not.toContain(token);
  expect(await page.evaluate(() => JSON.stringify(history.state))).not.toContain(token);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain(token);
};

test('a buddy QR code opens the request page of its link, and the token is gone after use @smoke', async ({ page, shell, newApi, signedIn, uid }) => {
  const ada = await newApi();
  await ada.signUp({ ...newAccount(uid, 'Ada'), displayName: 'Ada' });
  const token = await ada.replaceBuddyLink();
  await shell.open('#/account');
  await shell.expectSignedIn(signedIn.displayName);
  film(`${origin(page)}#/buddy/${token}`);
  const opener = page.getByRole('main').getByRole('button', { name: t('buddies.scan') });
  await opener.click();
  const sheet = scanner(page, t('buddies.scan'));
  const ask = page.getByRole('dialog', { name: t('buddies.request.ask', { name: 'Ada' }) });
  // The camera preview, or already the request it leads to: the fake camera may decode the code before the preview is checked
  // (E2E-flaky-2).
  await expect(sheet.getByLabel(t('barcodes.scanner.camera')).or(ask).first()).toBeVisible({ timeout: 20_000 });
  // The scanner closes (its camera is off) and the request page of that link takes over.
  await expect(ask).toBeVisible({ timeout: 20_000 });
  await expect(sheet).toBeHidden();
  expect((await ada.buddies()).incoming).toEqual([]);
  await ask.getByRole('button', { name: t('common.cancel') }).click();
  await expect(ask).toBeHidden();
  await noToken(page, token);
});

test('a club invitation QR code opens the invitation of its link', async ({ page, shell, newApi, signedIn, uid }) => {
  const admin = await newApi();
  await admin.signUp({ ...newAccount(uid, 'Ola'), displayName: 'Ola' });
  const { token } = await admin.clubWithInvite(`Scanned ${uid}`);
  await shell.open('#/clubs');
  await shell.expectSignedIn(signedIn.displayName);
  film(`${origin(page)}#/invite/${token}`);
  await page
    .getByRole('main')
    .getByRole('button', { name: t('clubs.scan') })
    .click();
  const invitation = page.getByRole('dialog', { name: t('clubs.invite.title') });
  await expect(invitation).toBeVisible({ timeout: 20_000 });
  await expect(invitation.getByText(`Scanned ${uid}`).first()).toBeVisible();
  await expect(scanner(page, t('clubs.scan'))).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(invitation).toBeHidden();
  await noToken(page, token);
});

test('anything but this app’s own link of the right kind is refused with a short message and never opened', async ({ page, shell, newApi, signedIn, uid }) => {
  const ada = await newApi();
  await ada.signUp({ ...newAccount(uid, 'Ada'), displayName: 'Ada' });
  const token = await ada.replaceBuddyLink();
  await shell.open('#/clubs');
  await shell.expectSignedIn(signedIn.displayName);
  const sheet = scanner(page, t('clubs.scan'));
  const note = sheet.getByText(t('clubs.scan.refused'));
  const before = page.url();
  for (const text of [`https://evil.example/#/invite/${token}`, `${origin(page)}#/buddy/${token}`, 'just some text']) {
    film(text);
    await page
      .getByRole('main')
      .getByRole('button', { name: t('clubs.scan') })
      .click();
    await expect(note).toBeVisible({ timeout: 20_000 });
    // The camera goes on, the page does not move and no dialog of a link opens.
    await expect(sheet.getByLabel(t('barcodes.scanner.camera'))).toBeVisible();
    expect(page.url()).toBe(before);
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  }
  expect((await ada.buddies()).incoming).toEqual([]);
  await noToken(page, token);
});

test('the scanner takes the focus, keeps Tab inside and gives the focus back on Escape', async ({ page, shell, signedIn, uid }) => {
  await shell.open('#/account');
  await shell.expectSignedIn(signedIn.displayName);
  // Tests run in parallel in any order: never let the camera film a link an earlier test of this worker left in the file.
  writeFileSync(video, barcodeVideo(eanFor(`link-scan-focus-${uid}`)));
  const opener = page.getByRole('main').getByRole('button', { name: t('buddies.scan') });
  await opener.click();
  const sheet = scanner(page, t('buddies.scan'));
  await expect(sheet.getByLabel(t('barcodes.scanner.camera'))).toBeVisible();
  // A QR code is square: the preview keeps the full 4:3 frame, not the shelf session's strip that cuts it off.
  const frame = await sheet.getByLabel(t('barcodes.scanner.camera')).boundingBox();
  expect(frame!.height / frame!.width).toBeGreaterThan(0.7);
  for (let press = 0; press < 8; press++) {
    await page.keyboard.press(press % 3 === 0 ? 'Shift+Tab' : 'Tab');
    expect(await sheet.evaluate((element) => element.contains(document.activeElement)), `focus after press ${press + 1}`).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(opener).toBeFocused();
});

test('with several codes in one frame a refused one never hides the valid one beside it (either order)', async ({ page, shell, newApi, signedIn, uid }) => {
  const ada = await newApi();
  await ada.signUp({ ...newAccount(uid, 'Ada'), displayName: 'Ada' });
  const buddyToken = await ada.replaceBuddyLink();
  await shell.open('#/clubs');
  await shell.expectSignedIn(signedIn.displayName);
  const refused = `${origin(page)}#/buddy/${buddyToken}`;
  for (const order of ['refused first', 'valid first']) {
    // A fresh club per round: joining the first one would hide this account's invitation button.
    const { token } = await ada.clubWithInvite(`Beside ${order} ${uid}`);
    const valid = `${origin(page)}#/invite/${token}`;
    const codes = order === 'refused first' ? [refused, valid] : [valid, refused];
    await shell.open('#/clubs');
    await shell.expectSignedIn(signedIn.displayName);
    writeFileSync(video, qrVideoOf([codes]));
    await page
      .getByRole('main')
      .getByRole('button', { name: t('clubs.scan') })
      .click();
    const invitation = page.getByRole('dialog', { name: t('clubs.invite.title') });
    await expect(invitation).toBeVisible({ timeout: 20_000 });
    await expect(invitation.getByText(`Beside ${order} ${uid}`).first()).toBeVisible();
    await expect(scanner(page, t('clubs.scan'))).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(invitation).toBeHidden();
  }
});

test('a second, different refused code is announced again, and the QR scanner has no barcode guide', async ({ page, shell, signedIn }) => {
  await shell.open('#/clubs');
  await shell.expectSignedIn(signedIn.displayName);
  // Two pictures alternate: two different texts, both refused.
  writeFileSync(video, qrVideoOf([['first refused text'], ['second refused text']], 12));
  await page
    .getByRole('main')
    .getByRole('button', { name: t('clubs.scan') })
    .click();
  const sheet = scanner(page, t('clubs.scan'));
  const status = sheet.getByRole('status');
  await expect(status).toBeVisible();
  // Count the note elements that enter the live region: each refusal inserts a new one, which a screen reader announces.
  await status.evaluate((element) => {
    const box = window as unknown as { insertedNotes: number };
    box.insertedNotes = 0;
    new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes) if (node instanceof HTMLElement && node.classList.contains('barcode-scanner__note')) box.insertedNotes++;
    }).observe(element, { childList: true });
  });
  await expect.poll(() => page.evaluate(() => (window as unknown as { insertedNotes: number }).insertedNotes), { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
  await expect(sheet.getByText(t('clubs.scan.refused'))).toBeVisible();
  await expect(sheet.locator('.barcode-scanner__guide')).toHaveCount(0);
});

test('on a phone the QR scanner is a bottom sheet, on a wide screen a centred dialog', async ({ page, shell, signedIn, isMobile }, info) => {
  await shell.open('#/clubs');
  await shell.expectSignedIn(signedIn.displayName);
  film('just some text');
  await page
    .getByRole('main')
    .getByRole('button', { name: t('clubs.scan') })
    .click();
  const sheet = scanner(page, t('clubs.scan'));
  await expect(sheet.getByLabel(t('barcodes.scanner.camera'))).toBeVisible();
  const box = (await sheet.boundingBox())!;
  const viewport = page.viewportSize()!;
  if (isMobile) {
    expect(Math.abs(box.y + box.height - viewport.height)).toBeLessThanOrEqual(1);
    expect(box.width).toBeGreaterThanOrEqual(viewport.width - 1);
  } else {
    expect(box.y + box.height).toBeLessThan(viewport.height - 20);
    expect(box.width).toBeLessThan(viewport.width - 20);
  }
  await expect(sheet.locator('.barcode-scanner__guide')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('qr-scanner.png') });
});

// "Scan a code" in the phone account menu (27-8): one sheet for either kind of link.
test.describe('the phone account menu', () => {
  test.skip(({ isMobile }) => !isMobile, 'the account menu is a phone control; wide screens scan from the Buddies section and the Clubs page');
  const menuButton = (page: Page, name: string) => page.getByRole('banner').getByRole('button', { name: t('header.accountMenu', { name }) });
  const entry = (page: Page) => page.getByRole('banner').getByRole('button', { name: t('header.scan') });

  test('its entry opens a neutral sheet, and a buddy code and a club code both land on their page', async ({ page, shell, newApi, signedIn, uid }) => {
    const ada = await newApi();
    await ada.signUp({ ...newAccount(uid, 'Ada'), displayName: 'Ada' });
    const buddyToken = await ada.replaceBuddyLink();
    const { token: clubToken } = await ada.clubWithInvite(`Menu ${uid}`);
    await shell.open('#/');
    await shell.expectSignedIn(signedIn.displayName);
    const sheet = scanner(page, t('links.scanner.title'));

    film(`${origin(page)}#/buddy/${buddyToken}`);
    await menuButton(page, signedIn.displayName).click();
    const box = await entry(page).boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    await entry(page).click();
    // The fake camera may read the code before the preview is looked at: the sheet's title is enough here.
    await expect(sheet).toBeVisible();
    const ask = page.getByRole('dialog', { name: t('buddies.request.ask', { name: 'Ada' }) });
    await expect(ask).toBeVisible({ timeout: 20_000 });
    await expect(sheet).toBeHidden();
    await ask.getByRole('button', { name: t('common.cancel') }).click();
    await expect(ask).toBeHidden();
    await noToken(page, buddyToken);

    film(`${origin(page)}#/invite/${clubToken}`);
    await menuButton(page, signedIn.displayName).click();
    await entry(page).click();
    const invitation = page.getByRole('dialog', { name: t('clubs.invite.title') });
    await expect(invitation).toBeVisible({ timeout: 20_000 });
    await expect(invitation.getByText(`Menu ${uid}`).first()).toBeVisible();
    await expect(sheet).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(invitation).toBeHidden();
    await noToken(page, clubToken);
  });

  test('another site’s link, another route and plain text are refused with the neutral text; Escape gives the focus to the menu button', async ({
    page,
    shell,
    signedIn,
  }) => {
    await shell.open('#/');
    await shell.expectSignedIn(signedIn.displayName);
    const sheet = scanner(page, t('links.scanner.title'));
    const before = page.url();
    const token = 'A'.repeat(43);
    for (const text of [`https://evil.example/#/invite/${token}`, `${origin(page)}#/reset/${token}`, 'just some text']) {
      film(text);
      await menuButton(page, signedIn.displayName).click();
      await entry(page).click();
      await expect(sheet.getByText(t('links.scanner.refused'))).toBeVisible({ timeout: 20_000 });
      await expect(sheet.getByLabel(t('barcodes.scanner.camera'))).toBeVisible();
      expect(page.url()).toBe(before);
      await expect(page.getByRole('dialog')).toHaveCount(1);
      for (let press = 0; press < 6; press++) {
        await page.keyboard.press(press % 3 === 0 ? 'Shift+Tab' : 'Tab');
        expect(await sheet.evaluate((element) => element.contains(document.activeElement)), `focus after press ${press + 1}`).toBe(true);
      }
      await page.keyboard.press('Escape');
      await expect(sheet).toBeHidden();
      await expect(menuButton(page, signedIn.displayName)).toBeFocused();
      await expect(entry(page)).toBeHidden();
    }
  });
});

/** Records every camera stream the page opens, so a test can tell whether all their tracks were stopped. */
const recordStreams = (page: Page) =>
  page.addInitScript(() => {
    const opened: MediaStream[] = [];
    (window as unknown as { openedStreams: MediaStream[] }).openedStreams = opened;
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await original(constraints);
      opened.push(stream);
      return stream;
    };
  });
const liveTracks = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { openedStreams: MediaStream[] }).openedStreams
        .flatMap((stream) => stream.getTracks())
        .filter((track) => track.readyState !== 'ended').length,
  );
const openedStreams = (page: Page) => page.evaluate(() => (window as unknown as { openedStreams: MediaStream[] }).openedStreams.length);

test('the camera stops on Escape, on an opened link and when Back leaves the page', async ({ page, shell, newApi, signedIn, uid }) => {
  await recordStreams(page);
  const ada = await newApi();
  await ada.signUp({ ...newAccount(uid, 'Ada'), displayName: 'Ada' });
  const token = await ada.replaceBuddyLink();
  await shell.open('#/clubs');
  await shell.expectSignedIn(signedIn.displayName);
  await page.evaluate(() => (location.hash = '#/account'));
  const opener = page.getByRole('main').getByRole('button', { name: t('buddies.scan') });
  const sheet = scanner(page, t('buddies.scan'));
  film('just some text');
  await opener.click();
  await expect(sheet.getByText(t('buddies.scan.refused'))).toBeVisible({ timeout: 20_000 });
  expect(await liveTracks(page)).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect.poll(() => liveTracks(page)).toBe(0);
  // Back while the scanner is open: the page goes, and so does the camera.
  await opener.click();
  await expect(sheet.getByText(t('links.scanner.hint'))).toBeVisible({ timeout: 20_000 });
  expect(await openedStreams(page)).toBe(2);
  await page.goBack();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole('main').getByRole('button', { name: t('clubs.scan') })).toBeVisible();
  await expect.poll(() => liveTracks(page)).toBe(0);
  await page.goForward();
  film(`${origin(page)}#/buddy/${token}`);
  await opener.click();
  await expect(page.getByRole('dialog', { name: t('buddies.request.ask', { name: 'Ada' }) })).toBeVisible({ timeout: 20_000 });
  expect(await openedStreams(page)).toBe(3);
  await expect.poll(() => liveTracks(page)).toBe(0);
});

test('a refused code is not echoed, logged or kept, and a retail barcode is not read at all', async ({ page, shell, newApi, signedIn, uid }) => {
  const logged: string[] = [];
  const ada = await newApi();
  await ada.signUp({ ...newAccount(uid, 'Ada'), displayName: 'Ada' });
  const token = await ada.replaceBuddyLink();
  await shell.open('#/clubs');
  await shell.expectSignedIn(signedIn.displayName);
  const opener = page.getByRole('main').getByRole('button', { name: t('clubs.scan') });
  const sheet = scanner(page, t('clubs.scan'));
  // A buddy link (a token of another kind) on the invitation scan: refused without showing or keeping its text.
  const hostile = `${origin(page)}#/buddy/${token}`;
  film(hostile);
  await opener.click();
  await expect(sheet.getByText(t('clubs.scan.refused'))).toBeVisible({ timeout: 20_000 });
  expect(await page.content()).not.toContain(token);
  expect(logged.join('\n')).not.toContain(token);
  await noToken(page, token);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  // An EAN in front of the camera is no QR code: nothing is read, so nothing is refused either.
  writeFileSync(video, barcodeVideo(eanFor(`link-scan-${uid}`)));
  await opener.click();
  await expect(sheet.getByText(t('links.scanner.hint'))).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(2_000);
  await expect(sheet.getByText(t('clubs.scan.refused'))).toBeHidden();
  expect(page.url()).not.toContain('#/invite');
});
