import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { DIALOG, expectAccessible } from '../support/axe';
import { barcodeVideo, eanFor, qrVideo } from '../support/barcodes';
import { t } from '../support/i18n';
import { FIXTURES, chromeBinary } from '../support/paths';
import { expect, newAccount, test } from '../support/test';

// The camera runs only while the page is visible and the scanner mounted (REVIEW-10). The fake camera films the file each
// test writes just before the camera starts (parallel tests of a worker share it); a real camera is never reached.
const video = join(FIXTURES, `camera-pause-${process.pid}.y4m`);
mkdirSync(FIXTURES, { recursive: true });
writeFileSync(video, barcodeVideo(null));

test.use({
  launchOptions: {
    executablePath: chromeBinary(),
    args: ['--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`],
  },
  permissions: ['camera'],
});

declare global {
  interface Window {
    cameraStreams?: MediaStream[];
  }
}

test.beforeEach(async ({ page }) => {
  writeFileSync(video, barcodeVideo(null));
  // Test-side only: remember every stream the page opened, so a test can read its tracks after the preview is gone.
  await page.addInitScript(() => {
    const media = navigator.mediaDevices;
    const open = media.getUserMedia.bind(media);
    const streams: MediaStream[] = [];
    window.cameraStreams = streams;
    media.getUserMedia = async (constraints) => {
      const stream = await open(constraints);
      streams.push(stream);
      return stream;
    };
  });
});

/** The state of every video track the page opened so far, oldest first. */
const tracks = (page: Page) => page.evaluate(() => (window.cameraStreams ?? []).flatMap((stream) => stream.getVideoTracks().map((track) => track.readyState)));

/**
 * Headless Chromium keeps every page visible, also behind another tab, so the page's visibility is overridden and the
 * event dispatched, as the browser does when a tab goes to the background or the phone screen locks.
 */
const setHidden = (page: Page, hidden: boolean) =>
  page.evaluate((value) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (value ? 'hidden' : 'visible') });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => value });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);

const openFindScanner = async (page: Page) => {
  await page
    .getByRole('main')
    .getByRole('button', { name: t('barcodes.scan'), exact: true })
    .click();
  const scanner = page.getByRole('dialog', { name: t('barcodes.scanner.findTitle') });
  await expect(scanner.getByLabel(t('barcodes.scanner.camera'))).toBeVisible();
  await expect.poll(() => tracks(page)).toEqual(['live']);
  return scanner;
};

test('a hidden page turns the camera off; the scanner waits for Resume, which restarts it, and a scan still works', async ({ page, shell, uid }) => {
  await shell.open();
  const scanner = await openFindScanner(page);
  await setHidden(page, true);
  await expect.poll(() => tracks(page)).toEqual(['ended']);
  await setHidden(page, false);
  const resume = scanner.getByRole('button', { name: t('barcodes.scanner.resume') });
  await expect(scanner.getByRole('status').filter({ hasText: t('barcodes.scanner.pausedAway') })).toBeVisible();
  await expect(resume).toBeVisible();
  await expect(scanner.getByLabel(t('barcodes.scanner.camera'))).toHaveCount(0);
  // Visible again, the camera stays off until the person asks for it.
  expect(await tracks(page)).toEqual(['ended']);
  await expectAccessible(page, { include: [DIALOG] });

  const barcode = eanFor(`camera-pause-${uid}`);
  writeFileSync(video, barcodeVideo(barcode));
  await resume.click();
  await expect(page.getByText(t('barcodes.discover.unknown', { barcode }))).toBeVisible({ timeout: 20_000 });
  await expect(scanner).toBeHidden();
  // The handed-over code stopped the second camera too.
  expect(await tracks(page)).toEqual(['ended', 'ended']);
});

test('a route change with the scanner still open turns the camera off', async ({ page, shell, uid }) => {
  await shell.open();
  const scanner = await openFindScanner(page);
  // Explore stays mounted across its own routes, so the dialog stays too.
  await page.evaluate((query) => (location.hash = `#/?q=${query}`), uid);
  await expect.poll(() => tracks(page)).toEqual(['ended']);
  const resume = scanner.getByRole('button', { name: t('barcodes.scanner.resume') });
  await resume.focus();
  await page.keyboard.press('Enter');
  // The pressed button goes with the paused state; the focus stays in the dialog.
  await expect(scanner.getByRole('button', { name: t('common.close'), exact: true })).toBeFocused();
  await expect.poll(() => tracks(page)).toEqual(['ended', 'live']);
  await expect(scanner.getByLabel(t('barcodes.scanner.camera'))).toBeVisible();
});

test('two minutes without a scan turn the camera off', async ({ page, shell }) => {
  await page.clock.install();
  await shell.open();
  const scanner = await openFindScanner(page);
  // One jump, so the scan loop's timers do not all run on the way.
  await page.clock.fastForward(2 * 60_000);
  await expect.poll(() => tracks(page)).toEqual(['ended']);
  await expect(scanner.getByRole('status').filter({ hasText: t('barcodes.scanner.pausedIdle') })).toBeVisible();
  await expect(scanner.getByRole('button', { name: t('barcodes.scanner.resume') })).toBeVisible();
});

test('the QR link scanner pauses on a hidden page and reads an invitation after Resume', async ({ page, shell, newApi, signedIn, uid }) => {
  const admin = await newApi();
  await admin.signUp({ ...newAccount(uid, 'Ola'), displayName: 'Ola' });
  const { token } = await admin.clubWithInvite(`Paused ${uid}`);
  writeFileSync(video, barcodeVideo(eanFor(`camera-pause-neutral-${uid}`)));
  await shell.open('#/clubs');
  await shell.expectSignedIn(signedIn.displayName);
  await page
    .getByRole('main')
    .getByRole('button', { name: t('clubs.scan') })
    .click();
  const scanner = page.getByRole('dialog', { name: t('clubs.scan') });
  await expect(scanner.getByLabel(t('barcodes.scanner.camera'))).toBeVisible();
  await expect.poll(() => tracks(page)).toEqual(['live']);
  await setHidden(page, true);
  await expect.poll(() => tracks(page)).toEqual(['ended']);
  await setHidden(page, false);
  writeFileSync(video, qrVideo(`${new URL(page.url()).origin}/#/invite/${token}`));
  await scanner.getByRole('button', { name: t('barcodes.scanner.resume') }).click();
  const invitation = page.getByRole('dialog', { name: t('clubs.invite.title') });
  await expect(invitation).toBeVisible({ timeout: 20_000 });
  await expect(scanner).toBeHidden();
  expect(await tracks(page)).toEqual(['ended', 'ended']);
});
