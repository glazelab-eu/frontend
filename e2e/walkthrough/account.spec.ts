import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FRONTEND } from '../support/paths';
import { t } from '../support/i18n';
import { AvatarSection } from '../support/pages/avatar';
import { expect, filmQr, test } from './support';

/** The account page: profile and picture crop, buddies, buddy link and QR, password, error reports, photo suggestions, sign out. */
test('account page: picture, buddies, buddy link, password, reports, suggestions, sign out', async ({ page, begin, finish, human, signIn }) => {
  await signIn();
  const main = page.getByRole('main');
  await begin('#/account', (p) =>
    p
      .getByRole('main')
      .getByRole('heading', { level: 1, name: t('account.page.title'), exact: true })
      .waitFor(),
  );
  await human.browse(1, 380);

  // The profile picture: choose a photo, position it in the crop dialog, use it.
  await human.tryStep('avatar crop', async () => {
    const avatar = new AvatarSection(page);
    await human.scroll(0);
    await human.point(avatar.choose);
    await avatar.pick({ name: 'mug.jpg', mimeType: 'image/jpeg', buffer: readFileSync(join(FRONTEND, 'e2e', 'fixtures', 'mug-photo.jpg')) });
    await expect(avatar.crop).toBeVisible();
    await human.pause(1800);
    await human.tap(avatar.crop.getByRole('button', { name: t('crop.zoomIn') }));
    await human.tap(avatar.crop.getByRole('button', { name: t('crop.zoomIn') }));
    const box = (await avatar.stage.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 40, box.y + box.height / 2 + 20, { steps: 15 });
    await page.mouse.up();
    await human.pause(1500);
    await human.tap(avatar.save);
    await expect(page.getByRole('status').filter({ hasText: t('notices.avatarSaved') })).toBeVisible();
    await human.pause(1800);
  });
  await human.browse(1, 520);

  // Buddies: the list, a request to accept, a request sent, and the buddy link with its QR code.
  await human.tryStep('buddies', async () => {
    await human.tap(main.getByRole('button', { name: /^Accept request from/ }).first());
    await human.pause(1600);
    await human.browse(1, 480);
  });
  await human.tryStep('buddy link', async () => {
    await human.tap(
      main
        .getByRole('button', { name: t('buddies.link.create') })
        .or(main.getByRole('button', { name: t('buddies.link.replace') }))
        .first(),
    );
    await human.pause(2800);
    await human.browse(1, 420);
  });
  await human.browse(1, 520);

  // Password dialog (opened and left), error reports, photo suggestions and similar looks (the questions only).
  await human.tryStep('password', async () => {
    await human.tap(main.getByRole('button', { name: t('account.password.title') }));
    const dialog = page.getByRole('dialog');
    await human.type(dialog.getByLabel(t('account.password.current')), 'correct horse');
    await human.pause(1000);
    await page.keyboard.press('Escape');
    await human.pause(700);
  });
  await human.tryStep('error reports', async () => {
    await human.tap(
      main
        .getByRole('checkbox', { name: t('account.page.diagnostics.switch') })
        .or(main.getByLabel(t('account.page.diagnostics.switch')))
        .first(),
    );
    await human.pause(1500);
    await human.browse(1, 480);
  });
  await human.tryStep('suggestions', async () => {
    await human.browse(1, 520);
    await human.pause(1500);
    await human.browse(1, 520);
  });
  await human.tryStep('sign out', async () => {
    await human.tap(main.getByRole('button', { name: t('header.signOut') }));
    await human.pause(2000);
  });
  await finish('account');
});

/** The phone's account menu: Show my buddy code (QR), Scan a code (the fake camera films a club invitation QR), language, sign out. */
test('account menu on the phone: buddy code and scanning a code', async ({ page, begin, finish, human, signIn, seed, baseURL }) => {
  await signIn();
  const header = page.getByRole('banner');
  const menu = header.getByRole('button', { name: /^Account menu/ });
  await begin('#/', (p) => p.getByRole('article').first().waitFor());
  await human.tap(menu);
  await human.pause(1500);
  await human.tap(header.getByRole('button', { name: t('header.buddyCode') }));
  const dialog = page.getByRole('dialog', { name: t('buddies.code.title') });
  await expect(dialog).toBeVisible();
  await human.pause(3500);
  await page.keyboard.press('Escape');
  await human.pause(800);
  await human.tryStep('scan a code', async () => {
    filmQr(`${baseURL}/#/invite/${seed.chemistsInvite}`);
    await human.tap(menu);
    await human.tap(header.getByRole('button', { name: t('header.scan') }));
    await expect(page.getByRole('heading', { name: t('clubs.invite.title') })).toBeVisible({ timeout: 30_000 });
    await human.pause(2500);
  });
  await finish('account-menu');
});
