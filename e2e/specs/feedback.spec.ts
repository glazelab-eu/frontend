import type { Locator, Page } from '@playwright/test';
import { BISQUE_STEP } from '../support/api';
import { t } from '../support/i18n';
import { photoPng, png } from '../support/images';
import { ExplorePage } from '../support/pages/explore';
import { grantSiteAdmin } from '../support/site-admin';
import { expect, newAccount, test } from '../support/test';

/**
 * In-app feedback (FEEDBACK-1, backend "Feedback"): a signed-in account opens it from the header (the phone account menu, the wide
 * header's icon) or the footer, writes, adds up to three photos, sees the context it sends and can untick it; the draft stays while
 * offline and after a failed send; site admins read it on the Feedback page, open its photos, mark it done and delete it.
 */

/** The multipart bodies of `POST /api/feedback` the page sends. */
function feedbackRequests(page: Page) {
  const bodies: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/feedback') bodies.push(request.postDataBuffer()?.toString('latin1') ?? '');
  });
  return bodies;
}

const entryOf = (page: Page, text: string) => page.locator('.feedback-admin__entry').filter({ hasText: text });
const textbox = (dialog: Locator) => dialog.getByRole('textbox', { name: t('feedback.message') });
const sendButton = (dialog: Locator) => dialog.getByRole('button', { name: t('feedback.send'), exact: true });

test('a signed-in account sends text, photos and context; a site admin reads it, opens a photo, marks it done and deletes it @smoke', async ({
  page,
  shell,
  signedIn,
  uid,
  encoder,
}) => {
  void encoder;
  test.setTimeout(90_000);
  const sent = feedbackRequests(page);
  await shell.open('#/stock');
  const dialog = await shell.openFeedback();
  // It starts at the text, shows what goes with it and says who reads it.
  await expect(textbox(dialog)).toBeFocused();
  await expect(dialog.getByText(t('feedback.whatIsSent'))).toBeVisible();
  await expect(dialog.getByText('stock', { exact: true })).toBeVisible();
  const message = `The shelf jumps when I scan ${uid}`;
  await textbox(dialog).fill(message);
  await expect(dialog.getByText(t('feedback.count', { count: message.length, max: 2000 }))).toBeVisible();
  await dialog.locator('input[type="file"]').setInputFiles([photoPng('one.png', 2400, 1800), png('two.png')]);
  await expect(dialog.getByRole('img', { name: t('feedback.photo', { number: 2 }) })).toBeVisible();
  await expect(dialog.getByRole('img', { name: t('feedback.photo', { number: 1 }) })).toBeVisible();
  await sendButton(dialog).click();
  await expect(page.getByText(t('notices.feedbackSent'))).toBeVisible();
  await expect(dialog).toBeHidden();
  expect(sent).toHaveLength(1);
  // The draft went with the send: the dialog opens empty again.
  const again = await shell.openFeedback();
  await expect(textbox(again)).toHaveValue('');
  await again.getByRole('button', { name: t('common.cancel') }).click();

  await grantSiteAdmin(signedIn.email);
  await page.goto('about:blank');
  await shell.open('#/admin/feedback');
  const entry = entryOf(page, message);
  await expect(entry).toBeVisible();
  await expect(entry.getByText(signedIn.displayName, { exact: true })).toBeVisible();
  await expect(entry.getByText('stock', { exact: true })).toBeVisible();
  const thumbnails = entry.getByRole('button', { name: new RegExp(t('feedbackAdmin.openPhoto', { number: 1, name: signedIn.displayName })) });
  await expect(thumbnails).toBeVisible();
  await thumbnails.click();
  const viewer = page.getByRole('dialog', { name: t('feedbackAdmin.photoTitle', { number: 1, name: signedIn.displayName }) });
  await expect(viewer).toBeVisible();
  await expect.poll(() => viewer.locator('img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth)).toBe(1600);
  await page.keyboard.press('Escape');
  await expect(viewer).toBeHidden();
  await expect(thumbnails).toBeFocused();

  await entry.getByRole('button', { name: new RegExp(`^${t('feedbackAdmin.markDone')}`) }).click();
  await expect(page.getByText(t('notices.feedbackDone'))).toBeVisible();
  await expect(entryOf(page, message)).toHaveCount(0);
  await page.getByLabel(t('feedbackAdmin.filter')).selectOption('DONE');
  await expect(entryOf(page, message)).toBeVisible();
  await entryOf(page, message)
    .getByRole('button', { name: new RegExp(`^${t('feedbackAdmin.delete')}`) })
    .click();
  const confirm = page.getByRole('dialog', { name: t('feedbackAdmin.delete.title') });
  await confirm.getByRole('button', { name: t('feedbackAdmin.delete'), exact: true }).click();
  await expect(page.getByText(t('notices.feedbackDeleted'))).toBeVisible();
  await expect(entryOf(page, message)).toHaveCount(0);
});

test('unticking the details sends the text alone; the footer opens the dialog too', async ({ page, shell, signedIn, uid }) => {
  const sent = feedbackRequests(page);
  await shell.open('#/');
  await shell.footer.getByRole('button', { name: t('feedback.open') }).click();
  const dialog = page.getByRole('dialog', { name: t('feedback.title') });
  await textbox(dialog).fill(`Just text ${uid}`);
  await dialog.getByRole('checkbox', { name: t('feedback.withContext') }).uncheck();
  await expect(dialog.getByText(t('feedback.context.page'), { exact: true })).toBeHidden();
  await sendButton(dialog).click();
  await expect(page.getByText(t('notices.feedbackSent'))).toBeVisible();
  expect(sent).toHaveLength(1);
  // Nothing but the text arrived: the admins' list says the details were left out.
  await grantSiteAdmin(signedIn.email);
  await page.goto('about:blank');
  await shell.open('#/admin/feedback');
  const entry = entryOf(page, `Just text ${uid}`);
  await expect(entry.getByText(t('feedbackAdmin.noContext'))).toBeVisible();
  await expect(entry.getByRole('button', { name: new RegExp(t('feedbackAdmin.openPhoto', { number: 1, name: signedIn.displayName })) })).toHaveCount(0);
});

test('a text of the full length with line breaks goes as the counter says (the browser sends each break as CRLF)', async ({ page, shell, signedIn, uid }) => {
  void signedIn;
  await shell.open('#/');
  const dialog = await shell.openFeedback();
  const line = `Line ${uid} `;
  const lines = Array.from({ length: 40 }, (_, index) => `${line}${index}`).join('\n');
  const message = lines + 'x'.repeat(2000 - lines.length);
  await textbox(dialog).fill(message);
  await expect(dialog.getByText(t('feedback.count', { count: 2000, max: 2000 }))).toBeVisible();
  await sendButton(dialog).click();
  await expect(page.getByText(t('notices.feedbackSent'))).toBeVisible();
  await expect(dialog).toBeHidden();
});

test('offline the draft stays and sending says it needs a connection; back online it goes', async ({ page, context, shell, signedIn, uid }) => {
  void signedIn;
  await shell.open('#/');
  let dialog = await shell.openFeedback();
  const message = `Written offline ${uid}`;
  await textbox(dialog).fill(message);
  await context.setOffline(true);
  await expect(dialog.getByText(t('feedback.offline'))).toBeVisible();
  await expect(sendButton(dialog)).toBeDisabled();
  // Closing keeps the draft for the next opening.
  await dialog.getByRole('button', { name: t('common.cancel') }).click();
  await expect(dialog).toBeHidden();
  dialog = await shell.openFeedback();
  await expect(textbox(dialog)).toHaveValue(message);
  await context.setOffline(false);
  await expect(sendButton(dialog)).toBeEnabled();
  await sendButton(dialog).click();
  await expect(page.getByText(t('notices.feedbackSent'))).toBeVisible();
});

test('a refused send (the rate limit) keeps the draft and says why at the form', async ({ page, shell, signedIn, uid }) => {
  void signedIn;
  await page.route('**/api/feedback', (route) =>
    route.fulfill({ status: 429, headers: { 'Retry-After': '600' }, contentType: 'application/json', body: JSON.stringify({ error: 'Too many requests' }) }),
  );
  await shell.open('#/');
  const dialog = await shell.openFeedback();
  const message = `Too many ${uid}`;
  await textbox(dialog).fill(message);
  await sendButton(dialog).click();
  await expect(dialog.getByRole('alert')).toHaveText(t('errors.tooManyRequests'));
  await expect(textbox(dialog)).toHaveValue(message);
  await expect(dialog).toBeVisible();
});

/** Holds every photo decode until `releasePhotos()` runs in the page, so a test can act while a photo is still being prepared. */
async function holdPhotoDecoding(page: Page) {
  await page.addInitScript(() => {
    const original = window.createImageBitmap.bind(window) as (...args: unknown[]) => Promise<ImageBitmap>;
    let release = () => {};
    const held = new Promise<void>((done) => (release = done));
    Object.assign(window, { releasePhotos: release });
    window.createImageBitmap = ((...args: unknown[]) => held.then(() => original(...args))) as typeof createImageBitmap;
  });
}
const releasePhotos = (page: Page) => page.evaluate(() => (window as unknown as { releasePhotos: () => void }).releasePhotos());

test('while a photo is being prepared the dialog stays open, and the photo joins the draft', async ({ page, shell, signedIn, uid }) => {
  void signedIn;
  await holdPhotoDecoding(page);
  await shell.open('#/');
  let dialog = await shell.openFeedback();
  await textbox(dialog).fill(`Waiting ${uid}`);
  await dialog.locator('input[type="file"]').setInputFiles([png('held.png')]);
  await expect(dialog.getByText(t('feedback.preparing'))).toBeVisible();
  await expect(dialog.getByRole('button', { name: t('common.cancel') })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await releasePhotos(page);
  await expect(dialog.getByRole('img', { name: t('feedback.photo', { number: 1 }) })).toBeVisible();
  await dialog.getByRole('button', { name: t('common.cancel') }).click();
  await expect(dialog).toBeHidden();
  dialog = await shell.openFeedback();
  await expect(dialog.getByRole('img', { name: t('feedback.photo', { number: 1 }) })).toBeVisible();
});

test('a page change while a photo is being prepared says the photo was not added and keeps the text', async ({ page, shell, signedIn, uid }) => {
  void signedIn;
  await holdPhotoDecoding(page);
  await shell.open('#/');
  let dialog = await shell.openFeedback();
  const message = `Moved away ${uid}`;
  await textbox(dialog).fill(message);
  await dialog.locator('input[type="file"]').setInputFiles([png('held.png')]);
  await expect(dialog.getByText(t('feedback.preparing'))).toBeVisible();
  // Back or the address bar: another page closes every dialog.
  await page.evaluate(() => (location.hash = '#/clubs'));
  await expect(dialog).toBeHidden();
  await expect(page.getByText(t('notices.feedbackPhotoDropped'))).toBeVisible();
  await releasePhotos(page);
  dialog = await shell.openFeedback();
  await expect(textbox(dialog)).toHaveValue(message);
  await expect(dialog.getByText(t('feedback.preparing'))).toHaveCount(0);
  await expect(dialog.getByRole('img')).toHaveCount(0);
});

test('guests have no feedback button', async ({ page, shell }) => {
  await shell.open('#/');
  await shell.expectGuest();
  await expect(page.getByRole('button', { name: t('feedback.open') })).toHaveCount(0);
});

test("deleting the account deletes its feedback from the admins' list", async ({ page, shell, signedIn, newApi, uid }) => {
  const sender = await newApi();
  const account = newAccount(uid, 'Leaver');
  await sender.signUp(account);
  const message = `Goodbye feedback ${uid}`;
  await sender.sendFeedback(message, 'account');
  await grantSiteAdmin(signedIn.email);
  await shell.open('#/admin/feedback');
  await expect(entryOf(page, message)).toBeVisible();
  await sender.deleteAccount(account.password);
  await page.goto('about:blank');
  await shell.open('#/admin/feedback');
  await expect(page.getByRole('heading', { level: 1, name: t('feedbackAdmin.title') })).toBeVisible();
  await expect(page.locator('.feedback-admin')).toHaveAttribute('aria-busy', 'false');
  await expect(entryOf(page, message)).toHaveCount(0);
});

test('the feedback entry never covers the page: the viewer covers it, the toast stays clear of it', async ({ page, shell, api, signedIn, uid, isMobile }) => {
  const title = `Covered ${uid}`;
  const id = await api.addCombination({ title, steps: [BISQUE_STEP], tags: ['cone-6'] });
  await api.uploadToCombination(id, { file: photoPng('tile.png', 480, 360), kind: 'TEST_TILE' });
  await shell.open(`#/?type=combinations&q=${uid}`);
  await shell.expectSignedIn(signedIn.displayName);
  // Phones: no feedback control on the screen outside the account menu and the footer at the end of the page; wide screens: an icon
  // in the header row, in the flow (never fixed over the page).
  const icon = shell.header.getByRole('button', { name: t('feedback.open'), exact: true });
  if (isMobile) await expect(icon).toHaveCount(0);
  else {
    await expect(icon).toBeVisible();
    expect(await icon.evaluate((button) => getComputedStyle(button).position)).toBe('static');
  }
  await new ExplorePage(page)
    .card(title)
    .getByRole('button', { name: t('images.cover.open', { title }) })
    .click();
  const viewer = page.getByRole('dialog', { name: t('images.viewer.label', { title }) });
  await expect(viewer).toBeVisible();
  if (!isMobile) {
    // What lies at the icon's place is the viewer: the icon cannot be reached over it.
    const box = (await icon.boundingBox())!;
    const covered = await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.modal--viewer'), {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
    });
    expect(covered).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(viewer).toBeHidden();
  // A toast (here the sent confirmation) never overlaps the feedback icon.
  const dialog = await shell.openFeedback();
  await textbox(dialog).fill(`Toast check ${uid}`);
  await sendButton(dialog).click();
  const toast = page.getByText(t('notices.feedbackSent'));
  await expect(toast).toBeVisible();
  if (!isMobile) {
    const [a, b] = [(await icon.boundingBox())!, (await toast.boundingBox())!];
    expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);
  }
});
