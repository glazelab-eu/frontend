import type { Page } from '@playwright/test';
import { BISQUE_STEP } from '../support/api';
import { t } from '../support/i18n';
import { StudioPage } from '../support/pages/studio';
import { expect, test } from '../support/test';
import { expectAccessible } from '../support/axe';

async function recoveries(page: Page): Promise<{ content: { title: string } }[]> {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const opening = indexedDB.open('glazelab-offline', 1);
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const db = opening.result;
          const tx = db.transaction('snapshots');
          const request = tx.objectStore('snapshots').getAll();
          request.onsuccess = () => resolve(request.result.filter((value) => value?.version === 1 && value?.content));
          tx.oncomplete = () => db.close();
        };
      }),
  );
}

async function reloadWithInput(page: Page) {
  page.once('dialog', (dialog) => dialog.accept());
  await page.reload();
}

test('recovers unfinished fields after reopening and clears the copy after saving', async ({ page, shell, signedIn, uid }, testInfo) => {
  await shell.open('#/studio');
  await shell.expectSignedIn(signedIn.displayName);
  let studio = new StudioPage(page);
  const title = `Recover ${uid}`;
  await studio.title.fill(title);
  await expect.poll(() => recoveries(page)).toMatchObject([{ content: { title } }]);
  await reloadWithInput(page);
  const offer = page.getByRole('region', { name: t('studio.recovery.title') });
  await expect(offer).toBeVisible();
  await expectAccessible(page);
  await page.screenshot({ path: testInfo.outputPath('recovery-offer.png'), fullPage: true });
  await offer.getByRole('button', { name: t('studio.recovery.restore'), exact: true }).click();
  studio = new StudioPage(page);
  await expect(studio.title).toHaveValue(title);
  await studio.saveDraft();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await expect.poll(() => recoveries(page)).toEqual([]);
  await shell.open('#/studio');
  await expect(offer).toHaveCount(0);
});

test('offers unsaved edits only on their own route and discards the recovery explicitly', async ({ page, shell, signedIn, api, uid }) => {
  const id = await api.addCombination({ title: `Original ${uid}`, steps: [BISQUE_STEP] });
  await shell.open(`#/studio/${id}`);
  await shell.expectSignedIn(signedIn.displayName);
  await new StudioPage(page).title.fill(`Edit ${uid}`);
  await expect.poll(() => recoveries(page)).toHaveLength(1);
  await reloadWithInput(page);
  await page.getByRole('button', { name: t('studio.recovery.discard'), exact: true }).click();
  await expect(new StudioPage(page).title).toHaveValue(`Original ${uid}`);
  await expect.poll(() => recoveries(page)).toEqual([]);
  await page.reload();
  await expect(page.getByRole('region', { name: t('studio.recovery.title') })).toHaveCount(0);
});

test('a form holding only a blank step keeps no recovery, so coming back asks nothing', async ({ page, shell, signedIn, uid }) => {
  await shell.open('#/studio');
  await shell.expectSignedIn(signedIn.displayName);
  const studio = new StudioPage(page);
  await studio.main
    .getByRole('button', { name: t('studio.addGlazeStep') })
    .last()
    .click();
  await studio.title.fill(`Blank ${uid}`);
  await expect.poll(() => recoveries(page)).toHaveLength(1);
  // Only the blank step is left: nothing a draft would keep, so leaving asks nothing and nothing stays on the device.
  await studio.title.fill('');
  await expect.poll(() => recoveries(page)).toEqual([]);
  await shell.open('#/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await shell.open('#/studio');
  await expect(new StudioPage(page).title).toBeEditable();
  await expect(page.getByRole('region', { name: t('studio.recovery.title') })).toHaveCount(0);
});

test('reopening an offline pending save restores fields without sending it', async ({ page, context, shell, signedIn, uid }) => {
  await shell.open('#/studio');
  await shell.expectSignedIn(signedIn.displayName);
  await context.setOffline(true);
  await new StudioPage(page).title.fill(`Offline ${uid}`);
  await page.getByRole('button', { name: t('studio.saveDraftLater'), exact: true }).click();
  await expect.poll(() => recoveries(page)).toHaveLength(1);
  // Simulate closing the tab while offline; a new page load can read the saved fields once online.
  await reloadWithInput(page).catch(() => {});
  let saves = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/combinations')) saves++;
  });
  await context.setOffline(false);
  await page.goto('/#/studio');
  await page.getByRole('button', { name: t('studio.recovery.restore'), exact: true }).click();
  await expect(new StudioPage(page).title).toHaveValue(`Offline ${uid}`);
  await expect(page.getByRole('button', { name: t('studio.saveDraft'), exact: true })).toBeEnabled();
  expect(saves).toBe(0);
});
