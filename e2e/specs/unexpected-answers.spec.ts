import type { Page, Route } from '@playwright/test';
import { t } from '../support/i18n';
import { expect, test } from '../support/test';

/** A snapshot the app saved on this device for `owner` (an account ID, or `guest`), as JSON text, or null. */
function savedSnapshot(page: Page, owner: string): Promise<string | null> {
  return page.evaluate(
    (key) =>
      new Promise<string | null>((resolve) => {
        const open = indexedDB.open('glazelab-offline', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('snapshots');
        open.onerror = () => resolve(null);
        open.onsuccess = () => {
          const read = open.result.transaction('snapshots').objectStore('snapshots').get(key);
          read.onsuccess = () => {
            open.result.close();
            resolve(read.result === undefined ? null : JSON.stringify(read.result));
          };
          read.onerror = () => resolve(null);
        };
      }),
    owner,
  );
}

const lastUserId = (page: Page) =>
  page.evaluate(() => (JSON.parse(localStorage.getItem('glazelab:v1:lastUser') ?? 'null') as { id?: string } | null)?.id ?? null);

/** What the API's tarpit, a proxy or a captive portal may answer with status 200. */
const decoy = (route: Route) => route.fulfill({ status: 200, contentType: 'application/octet-stream', body: Buffer.from([1, 2, 3, 250, 251]) });
const portal = (route: Route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>Sign in to the Wi-Fi</body></html>' });

test('a 200 on /me or a listing that is not the API data keeps the account and its snapshot, and sign-out leaves nothing private for a guest', async ({
  page,
  shell,
  api,
  signedIn,
  uid,
}) => {
  const jar = `Secret ${uid}`;
  const { id: glazeId } = await api.addGlaze({ newManufacturer: { name: `Mk ${uid}`, shortId: uid.toUpperCase() }, code: 'S-1', name: jar });
  await api.addStock({ glazeId, ownerType: 'personal', quantityG: 300 });
  await shell.open('#/stock');
  await shell.expectSignedIn(signedIn.displayName);
  const main = page.getByRole('main');
  await expect(main.getByText(jar).first()).toBeVisible();
  const accountId = (await lastUserId(page))!;
  await expect.poll(async () => (await savedSnapshot(page, accountId))?.includes(jar) ?? false).toBe(true);

  // Every /me answers the decoy: the start shows the account's snapshot and keeps it, the guest snapshot gets nothing.
  await page.route('**/api/auth/me', decoy);
  await page.goto('about:blank');
  await shell.open('#/stock');
  await shell.expectSignedIn(signedIn.displayName);
  await expect(main.getByText(jar).first()).toBeVisible();
  // A failed load, never a sign-out: after the silent retry the offline sign shows.
  await expect(page.getByRole('banner').getByRole('button', { name: t('header.offline') })).toBeVisible({ timeout: 15_000 });
  expect(await lastUserId(page)).toBe(accountId);
  expect(await savedSnapshot(page, accountId)).toContain(jar);
  expect(await savedSnapshot(page, 'guest')).toBeNull();
  await page.unroute('**/api/auth/me', decoy);

  // The shelf listing answers a portal page: the saved shelf stays on screen and in the snapshot.
  await page.route('**/api/stock', portal);
  await page.goto('about:blank');
  await shell.open('#/stock');
  await shell.expectSignedIn(signedIn.displayName);
  await expect(main.getByText(jar).first()).toBeVisible();
  expect(await savedSnapshot(page, accountId)).toContain(jar);
  await page.unroute('**/api/stock', portal);

  await shell.signOut();
  await shell.expectGuest();
  await expect(main.getByText(jar)).toHaveCount(0);
  await expect.poll(() => savedSnapshot(page, accountId)).toBeNull();
  // The guest snapshot (kept by sign-out for the next person) holds no shelf entry of the account.
  await expect.poll(async () => (await savedSnapshot(page, 'guest')) !== null).toBe(true);
  const guest = JSON.parse((await savedSnapshot(page, 'guest'))!) as { stock?: unknown[] };
  expect(guest.stock ?? []).toEqual([]);
});
