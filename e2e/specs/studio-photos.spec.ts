import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { expectAccessible } from '../support/axe';
import { t } from '../support/i18n';
import { StudioPage } from '../support/pages/studio';
import { expect, newAccount, test } from '../support/test';

/** Small real photos (CC0, `e2e/fixtures/README.md`), handed over by path. */
const MUG = fileURLToPath(new URL('../fixtures/mug-photo.jpg', import.meta.url));
const JUG = fileURLToPath(new URL('../fixtures/jug-photo.jpg', import.meta.url));

/** Every Studio recovery record in the device's snapshot store, as stored. */
async function recoveries(page: Page): Promise<{ content: Record<string, unknown> }[]> {
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

/** Whether anything in the snapshot store is a Blob or File, or names one of the fixture photos. */
async function storedPhotoData(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const opening = indexedDB.open('glazelab-offline', 1);
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const db = opening.result;
          const tx = db.transaction('snapshots');
          const request = tx.objectStore('snapshots').getAll();
          const binary = (value: unknown): boolean =>
            value instanceof Blob ||
            value instanceof ArrayBuffer ||
            ArrayBuffer.isView(value) ||
            (typeof value === 'string' && /mug-photo|jug-photo|^blob:|^data:image/.test(value)) ||
            (!!value && typeof value === 'object' && Object.values(value).some(binary));
          request.onsuccess = () => resolve(request.result.some(binary));
          tx.oncomplete = () => db.close();
        };
      }),
  );
}

/** Opens Studio with a titled combination of one glaze step, ready to publish. */
async function startCombination(
  page: Page,
  shell: { open: (hash: string) => Promise<void>; expectSignedIn: (name: string) => Promise<void> },
  name: string,
  title: string,
) {
  await shell.open('#/studio');
  await shell.expectSignedIn(name);
  const studio = new StudioPage(page);
  await studio.title.fill(title);
  await studio.main
    .getByRole('button', { name: t('studio.addCustomStep') })
    .first()
    .click();
  await studio.main.getByLabel(t('studio.step.label')).fill('Bisque firing');
  return studio;
}

const photoList = (page: Page) => page.getByRole('main').getByRole('list', { name: t('upload.list') });

test('records a combination with two photos of different kinds, which its page shows with those kinds @smoke', async ({
  page,
  shell,
  signedIn,
  uid,
  encoder,
}, info) => {
  void encoder;
  const title = `Recorded with photos ${uid}`;
  const studio = await startCombination(page, shell, signedIn.displayName, title);
  await studio.main.getByLabel(t('upload.library')).setInputFiles([MUG, JUG]);
  const files = photoList(page).getByRole('listitem');
  await expect(files).toHaveCount(2);
  await expect(studio.main.getByText(t('studio.photos.count', { count: 2, max: 10 }))).toBeVisible();
  await expect(files.nth(0).getByLabel(t('upload.kind'))).toHaveValue('TEST_TILE');
  await files
    .nth(1)
    .getByLabel(t('upload.kind'))
    .selectOption({ label: t('images.kind.finished') });
  await files.nth(1).getByText(t('upload.details')).click();
  await files.nth(1).getByLabel(t('images.details.caption')).fill(`Jug ${uid}`);
  // Each photo has a named remove button; Save draft stays available with photos attached.
  await expect(studio.main.getByRole('button', { name: t('upload.remove', { name: 'mug-photo.jpg' }) })).toBeVisible();
  await expect(studio.main.getByRole('button', { name: t('studio.saveDraft'), exact: true })).not.toHaveAttribute('aria-disabled', 'true');
  await files.nth(1).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('studio-photos-attached.png'), fullPage: true });

  const uploads: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/api\/combinations(\/[^/]+\/images)?(\?|$)/.test(request.url())) uploads.push(new URL(request.url()).pathname);
  });
  await studio.publish();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await expect(page).toHaveURL(/#\/combinations\/[0-9a-f-]{36}$/);
  const id = new URL(page.url()).hash.split('/')[2];
  // The combination first, then one request per photo, to the saved combination.
  expect(uploads).toEqual(['/api/combinations', `/api/combinations/${id}/images`, `/api/combinations/${id}/images`]);
  const gallery = page.getByRole('main').getByRole('region', { name: t('images.gallery', { title }) });
  const thumb = (current: number, kind: 'tile' | 'finished') =>
    gallery.getByRole('button', { name: t('images.thumbnail', { current, total: 2, kind: t(`images.kind.${kind}`) }) });
  // Finished pieces come first (`orderPhotos`), so the jug leads although it was attached second.
  await expect(thumb(1, 'finished')).toBeVisible();
  await expect(thumb(2, 'tile')).toBeVisible();
  await thumb(2, 'tile').click();
  await expect(gallery.getByText(`Jug ${uid}`)).toHaveCount(0);
  await thumb(1, 'finished').click();
  await expect(gallery.getByText(`Jug ${uid}`)).toBeVisible();
});

test('saves a draft with two photos that only its author sees until publishing shows them as chosen', async ({
  page,
  shell,
  signedIn,
  uid,
  encoder,
  api,
  newApi,
}, info) => {
  void encoder;
  const title = `Draft with photos ${uid}`;
  const studio = await startCombination(page, shell, signedIn.displayName, title);
  await studio.main.getByLabel(t('upload.library')).setInputFiles([MUG, JUG]);
  await expect(photoList(page).getByRole('listitem')).toHaveCount(2);
  await studio.main.getByLabel(t('upload.visibility.label')).selectOption('PUBLIC');
  await page.screenshot({ path: info.outputPath('studio-draft-photos.png'), fullPage: true });
  const uploads: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/api\/combinations(\/[^/]+\/images)?(\?|$)/.test(request.url())) uploads.push(new URL(request.url()).pathname);
  });
  await studio.saveDraft();
  // The draft first, then its photos, then the draft's page, which shows them to the author.
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await expect(page).toHaveURL(/#\/combinations\/[0-9a-f-]{36}$/);
  const id = new URL(page.url()).hash.split('/')[2];
  expect(uploads).toEqual(['/api/combinations', `/api/combinations/${id}/images`, `/api/combinations/${id}/images`]);
  const main = page.getByRole('main');
  await expect(main.getByText(t('combination.draft.note'))).toBeVisible();
  const gallery = main.getByRole('region', { name: t('images.gallery', { title }) });
  await expect(gallery.getByRole('button', { name: t('images.thumbnail', { current: 2, total: 2, kind: t('images.kind.tile') }) })).toBeVisible();
  await expect(main.getByRole('button', { name: t('images.addTestTile'), exact: true })).toBeEnabled();
  await page.screenshot({ path: info.outputPath('draft-page-photos.png'), fullPage: true });
  await expectAccessible(page);

  // Nobody else learns of the photos: another account and a guest get the unknown ID's 404 for every size.
  const own = (await api.combinations()).find((combo) => combo.id === id)!;
  expect(own.images.map((image) => image.visibility)).toEqual(['PUBLIC', 'PUBLIC']);
  const urls = own.images.flatMap((image) => [image.url, image.cardUrl]);
  const other = await newApi();
  await other.signUp(newAccount(uid, 'Bea'));
  const guest = await newApi();
  for (const person of [other, guest]) for (const url of urls) expect(await person.status(url), url).toBe(404);
  expect((await other.combinations()).some((combo) => combo.id === id)).toBe(false);

  await main.getByRole('button', { name: t('combination.publish'), exact: true }).click();
  await expect(main.getByText(t('combination.draft.note'))).toHaveCount(0);
  for (const person of [other, guest]) for (const url of urls) expect(await person.status(url), url).toBe(200);
});

test('a failed second upload keeps the saved combination and the failed photo for Retry, which then opens it', async ({
  page,
  shell,
  signedIn,
  uid,
  encoder,
}, info) => {
  void encoder;
  const title = `Partly uploaded ${uid}`;
  const studio = await startCombination(page, shell, signedIn.displayName, title);
  await studio.main.getByLabel(t('upload.library')).setInputFiles([MUG, JUG]);
  let calls = 0;
  await page.route('**/api/combinations/*/images**', async (route) => {
    calls++;
    // The second photo meets a server failure (a 5xx keeps session and connection).
    if (calls === 2) await route.fulfill({ status: 500, json: { error: 'Internal Server Error' } });
    else await route.continue();
  });
  await studio.publish();
  await expect(page.getByRole('status').filter({ hasText: t('upload.result', { done: 1, failed: 1 }) })).toBeVisible();
  await expect(page).toHaveURL(/#\/studio$/);
  const retry = studio.main.getByRole('button', { name: t('upload.retryNamed', { name: 'jug-photo.jpg' }) });
  await expect(retry).toBeFocused();
  await expect(studio.main.getByRole('alert')).not.toHaveCount(0);
  await expect(studio.main.getByText(t('studio.photos.failed'))).toBeVisible();
  // The fields are saved: they stay locked, and the combination is in Mine already.
  await expect(studio.title).toBeDisabled();
  await page.screenshot({ path: info.outputPath('studio-photos-failed.png'), fullPage: true });
  await expectAccessible(page);

  await page.unroute('**/api/combinations/*/images**');
  await retry.click();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  const gallery = page.getByRole('main').getByRole('region', { name: t('images.gallery', { title }) });
  await expect(gallery.getByRole('button', { name: t('images.thumbnail', { current: 2, total: 2, kind: t('images.kind.tile') }) })).toBeVisible();
});

test('Done after a failed upload opens the combination with the photos that arrived', async ({ page, shell, signedIn, uid, encoder }) => {
  void encoder;
  const title = `Done without ${uid}`;
  const studio = await startCombination(page, shell, signedIn.displayName, title);
  await studio.main.getByLabel(t('upload.library')).setInputFiles([MUG, JUG]);
  let calls = 0;
  await page.route('**/api/combinations/*/images**', async (route) => {
    calls++;
    if (calls === 2) await route.fulfill({ status: 500, json: { error: 'Internal Server Error' } });
    else await route.continue();
  });
  await studio.publish();
  await studio.main.getByRole('button', { name: t('studio.photos.done'), exact: true }).click();
  // No leave question: Done drops the failed photo on purpose.
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await expect(page.getByRole('img', { name: t('images.alt.tile', { title }) })).toBeVisible();
  expect(calls).toBe(2);
});

test('offline, photos stop the held save: the save waits for the connection, and removing them brings the held save back', async ({
  page,
  context,
  shell,
  signedIn,
  uid,
}) => {
  const studio = await startCombination(page, shell, signedIn.displayName, `Offline photos ${uid}`);
  await studio.main.getByLabel(t('upload.library')).setInputFiles(MUG);
  await context.setOffline(true);
  await expect(studio.main.getByText(t('studio.photos.offline'))).toBeVisible();
  await expect(studio.main.getByRole('button', { name: t('combination.publish'), exact: true })).toBeDisabled();
  await expect(studio.main.getByRole('button', { name: t('studio.publishLater'), exact: true })).toHaveCount(0);
  await studio.main.getByRole('button', { name: t('upload.remove', { name: 'mug-photo.jpg' }) }).click();
  await expect(studio.main.getByText(t('studio.offline'))).toBeVisible();
  await expect(studio.main.getByRole('button', { name: t('studio.publishLater'), exact: true })).toBeEnabled();
});

test('the recovery copy keeps the text and only how many photos there were; a restore says they were not kept', async ({ page, shell, signedIn, uid }) => {
  const title = `Recovered photos ${uid}`;
  const studio = await startCombination(page, shell, signedIn.displayName, title);
  await studio.main.getByLabel(t('upload.library')).setInputFiles([MUG, JUG]);
  await expect.poll(() => recoveries(page)).toMatchObject([{ content: { title, photos: 2 } }]);
  expect(await storedPhotoData(page)).toBe(false);
  page.once('dialog', (dialog) => dialog.accept());
  await page.reload();
  await page.getByRole('button', { name: t('studio.recovery.restore'), exact: true }).click();
  await expect(new StudioPage(page).title).toHaveValue(title);
  await expect(page.getByRole('status').filter({ hasText: t('studio.photos.notKept', { count: 2 }) })).toBeVisible();
  await expect(photoList(page)).toHaveCount(0);
});

test('attached photos alone count as unsaved input when leaving', async ({ page, shell, signedIn }) => {
  await shell.open('#/studio');
  await shell.expectSignedIn(signedIn.displayName);
  await page.getByRole('main').getByLabel(t('upload.library')).setInputFiles(MUG);
  await shell.header.getByRole('link', { name: t('nav.home') }).click();
  await expect(page.getByRole('dialog')).toContainText(t('drafts.discardCombination'));
  await expect(page).toHaveURL(/#\/studio$/);
});
