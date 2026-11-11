import { t } from '../support/i18n';
import { expect, test } from './support';

/** The site-admin pages, with the seeded site admin: bans, photo reports, photo deletions, profile-picture reports, error reports. */
for (const [slug, hash, heading] of [
  ['admin-bans', '#/bans', t('bans.title')],
  ['admin-photo-reports', '#/image-reports', t('images.reports.title')],
  ['admin-photo-deletions', '#/image-deletions', t('images.log.title')],
  ['admin-avatar-reports', '#/avatar-reports', null],
  ['admin-error-reports', '#/error-reports', t('errorReports.title')],
] as const) {
  test(`site admin: ${slug}`, async ({ page, begin, finish, human, signIn }) => {
    await signIn('admin');
    const main = page.getByRole('main');
    await begin(hash, (p) => p.getByRole('main').getByRole('heading', { level: 1 }).waitFor());
    if (heading) await expect(main.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await human.pause(1500);
    await human.browse(2, 520);
    await human.scroll(0);
    if (slug === 'admin-bans') {
      await human.tryStep('lift dialog', async () => {
        await human.tap(main.getByRole('button', { name: t('bans.lift') }).first());
        await human.pause(2200);
        await page.keyboard.press('Escape');
      });
    }
    if (slug === 'admin-photo-reports') {
      await human.tryStep('open item', async () => {
        await human.tap(main.getByRole('link', { name: t('images.reports.open') }).first());
        await human.pause(3000);
        await page.goBack();
        await human.pause(1200);
      });
      await human.tryStep('dismiss', async () => {
        await human.tap(main.getByRole('button', { name: t('images.reports.dismiss') }).first());
        await human.pause(1800);
      });
    }
    if (slug === 'admin-avatar-reports') {
      await human.tryStep('dismiss', async () => {
        await human.tap(main.getByRole('button', { name: /Dismiss/ }).first());
        await human.pause(1800);
      });
    }
    if (slug === 'admin-error-reports') {
      await human.tryStep('details', async () => {
        await human.tap(main.getByRole('button', { name: t('errorReports.details.show') }).first());
        await human.pause(1500);
        await human.browse(2, 480);
      });
      await human.tryStep('search', async () => {
        await human.scroll(0);
        await human.type(
          main
            .getByRole('searchbox', { name: t('errorReports.filter.search') })
            .or(main.getByLabel(t('errorReports.filter.search')))
            .first(),
          'TypeError',
        );
        await page.keyboard.press('Enter');
        await human.pause(1800);
      });
    }
    await finish(slug);
  });
}
