import type { Locator, Page } from '@playwright/test';
import { BISQUE_STEP } from '../support/api';
import { seededPicture } from '../support/images';
import { grantSiteAdmin } from '../support/site-admin';
import { expect, newAccount, test } from '../support/test';

/**
 * The API answers instants with Z (backend "Code rules"): a reader far from UTC sees the admin times in UTC, as their labels say, and
 * Explore orders combinations and glazes by the moment they were listed. Real API; the browser runs in a zone that is not UTC.
 */

/** The time of a record: its `datetime` is the API's instant, its text that instant in UTC (`formatServerTime`). */
async function expectUtcTime(row: Locator, before: number, after: number) {
  const time = row.locator('time');
  const instant = (await time.getAttribute('datetime')) ?? '';
  expect(instant).toMatch(/Z$/);
  const at = Date.parse(instant);
  // The suite's API runs on this host: its clock is the test's (to the second the API may round to).
  expect(at).toBeGreaterThanOrEqual(before - 1000);
  expect(at).toBeLessThanOrEqual(after + 1000);
  const utc = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(at);
  await expect(time).toHaveText(utc);
}

const entry = (page: Page, title: string) => page.getByRole('main').getByRole('listitem').filter({ hasText: title });

test.describe('a site admin in Los Angeles', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });

  test('reads the photo report and deletion times in UTC, as the labels say', async ({ page, shell, newApi, signedIn, uid }) => {
    test.setTimeout(120_000);
    const ben = await newApi();
    await ben.signUp({ ...newAccount(uid, 'Ben'), displayName: `Ben ${uid}` });
    const fay = await newApi();
    await fay.signUp({ ...newAccount(uid, 'Fay'), displayName: `Fay ${uid}` });
    const reported = `Reported ${uid}`;
    const removed = `Removed ${uid}`;
    const first = await ben.addCombination({ title: reported, steps: [BISQUE_STEP] });
    const second = await ben.addCombination({ title: removed, steps: [BISQUE_STEP] });
    const photo = await ben.uploadToCombination(first, { file: seededPicture(`${uid}-reported`, 'reported.png'), visibility: 'PUBLIC' });
    const gone = await ben.uploadToCombination(second, { file: seededPicture(`${uid}-removed`, 'removed.png'), visibility: 'PUBLIC' });
    const before = Date.now();
    await fay.reportImage(photo.id, `Times ${uid}`);
    await ben.removeImage(gone.id);
    const after = Date.now();
    await grantSiteAdmin(signedIn.email);
    expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe('America/Los_Angeles');

    await shell.open('#/admin/image-reports');
    await expectUtcTime(entry(page, reported), before, after);
    await shell.open('#/admin/image-deletions');
    await expectUtcTime(entry(page, removed), before, after);
  });
});

test.describe('a reader east of the server', () => {
  test.use({ timezoneId: 'Asia/Tokyo' });

  test('sees a combination published after a glaze above it in the newest-first order', async ({ page, shell, api, signedIn, uid }) => {
    await api.addGlaze({ newManufacturer: { name: `Times ${uid}`, shortId: uid.toUpperCase() }, code: 'T-1', name: `Glaze ${uid}` });
    await api.addCombination({ title: `Combination ${uid}`, steps: [BISQUE_STEP] });
    await shell.open(`#/?q=${uid}`);
    await expect(page.locator('.paged-grid__item').getByRole('heading')).toHaveText([`Combination ${uid}`, new RegExp(`Glaze ${uid}`)]);
  });
});
