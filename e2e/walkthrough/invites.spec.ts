import { t } from '../support/i18n';
import { expect, test } from './support';

test('buddy request page: a buddy link opened by a member', async ({ page, begin, finish, human, signIn, seed }) => {
  await signIn();
  await begin(`#/buddy/${seed.luciaBuddyToken}`, (p) => p.getByRole('button', { name: t('buddies.request.send') }).waitFor());
  await human.pause(2500);
  await human.tap(page.getByRole('button', { name: t('buddies.request.send') }));
  await human.pause(3000);
  await finish('buddy-request');
});

test('invite page: a club invitation opened by a member', async ({ page, begin, finish, human, signIn, seed }) => {
  await signIn();
  await begin(`#/invite/${seed.chemistsInvite}`, (p) => p.getByRole('button', { name: t('clubs.invite.join') }).waitFor());
  await human.pause(2500);
  await human.tap(page.getByRole('button', { name: t('clubs.invite.join') }));
  await expect(
    page
      .getByRole('status')
      .or(page.getByRole('heading', { name: 'Glaze Chemists' }))
      .first(),
  ).toBeVisible();
  await human.pause(3000);
  await finish('club-invite');
});
