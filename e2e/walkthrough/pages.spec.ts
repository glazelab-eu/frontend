import { OPERATOR_EMAIL } from '../support/backend';
import { t } from '../support/i18n';
import { expect, test } from './support';

test('terms of service page', async ({ page, begin, finish, human }) => {
  await begin('#/terms', (p) => p.getByRole('heading', { level: 1, name: t('terms.title') }).waitFor());
  await human.browse(7, 600);
  await human.scroll(0);
  await finish('terms');
});

test('about page', async ({ page, begin, finish, human }) => {
  await begin('#/about', (p) => p.getByRole('heading', { level: 1, name: t('about.title') }).waitFor());
  await human.browse(5, 600);
  await human.scroll(0);
  await finish('about');
});

test('contact address in the footer', async ({ page, begin, finish, human }) => {
  await begin('#/', (p) => p.getByRole('article').first().waitFor());
  await human.scroll(100000);
  const footer = page.locator('footer');
  await human.tap(footer.getByRole('button', { name: t('account.contact.show') }));
  await expect(footer.getByRole('link', { name: t('account.contact', { email: OPERATOR_EMAIL }) })).toBeVisible();
  await human.pause(3000);
  await finish('contact');
});

test('page not found', async ({ page, begin, finish, human }) => {
  await begin('#/there-is-no-such-page', (p) => p.getByRole('main').waitFor());
  await human.pause(3500);
  await finish('not-found');
});
