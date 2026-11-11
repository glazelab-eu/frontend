import { OPERATOR_EMAIL, SOURCE_URL } from '../support/backend';
import { t } from '../support/i18n';
import { mockApi } from '../support/mock-api';
import { expect, test } from '../support/test';

test('the footer reveals the operator address on request @smoke', async ({ page, shell }) => {
  await shell.open();
  await expect(shell.footer.getByRole('link', { name: t('account.contact', { email: OPERATOR_EMAIL }) })).toHaveCount(0);
  await shell.footer.getByRole('button', { name: t('account.contact.show') }).click();
  const link = shell.footer.getByRole('link', { name: t('account.contact', { email: OPERATOR_EMAIL }) });
  await expect(link).toHaveAttribute('href', `mailto:${OPERATOR_EMAIL}`);
  await expect(link).toBeFocused();
});

test('an unavailable address shows a message and the button again', async ({ page, shell }) => {
  await mockApi(page, { user: null, answers: { 'GET /api/auth/operator-contact': { status: 404, json: { error: 'No contact address is configured.' } } } });
  await shell.open();
  await shell.footer.getByRole('button', { name: t('account.contact.show') }).click();
  await expect(shell.footer.getByText(t('account.contact.failed'))).toBeVisible();
  await expect(shell.footer.getByRole('button', { name: t('account.contact.show') })).toBeVisible();
});

test('the footer links the source code and opens the third-party licences of the build, signed out and offline', async ({ page, shell, context }) => {
  await shell.open();
  await expect(shell.footer.getByRole('link', { name: t('app.sourceCode'), exact: true })).toHaveAttribute('href', SOURCE_URL);
  // Once the options are known the link stays when the connection drops.
  await context.setOffline(true);
  await expect(shell.footer.getByRole('link', { name: t('app.sourceCode'), exact: true })).toHaveAttribute('href', SOURCE_URL);
  await context.setOffline(false);
  await shell.footer.getByRole('link', { name: t('app.licences'), exact: true }).click();
  await expect(page).toHaveURL(/\/THIRD-PARTY-LICENSES\.txt$/);
  // Bundled packages, a worker's runtime and the hand-written sections (wasm notices, the service worker's Workbox).
  for (const text of ['svelte ', 'onnxruntime-web ', 'Eigen', 'zxing-cpp', 'Leptonica', 'Workbox ']) await expect(page.locator('body')).toContainText(text);
});

test('without a configured source URL the footer shows no source link', async ({ page, shell }) => {
  await mockApi(page, { user: null });
  await shell.open();
  await expect(shell.footer.getByRole('link', { name: t('app.licences'), exact: true })).toBeVisible();
  await expect(shell.footer.getByRole('link', { name: t('app.sourceCode'), exact: true })).toHaveCount(0);
});
