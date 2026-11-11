import { execFile } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { PASSWORD } from '../support/api';
import { withEncoder } from '../support/encoder-lock';
import { t } from '../support/i18n';
import { Naming, seedLibrary } from '../support/library';
import { Pace, RECORDING } from '../support/pace';
import { AddGlazeDialog } from '../support/pages/add-glaze';
import { AuthDialog } from '../support/pages/auth';
import { ExplorePage } from '../support/pages/explore';
import { StudioPage } from '../support/pages/studio';
import { OUTPUT } from '../support/paths';
import { expect, newAccount, test } from '../support/test';
import { testTile } from '../support/tiles';

/** Where a recording's clip goes: `GLAZELAB_WALKTHROUGH_OUT`, else next to the run's output folder. */
const CLIP = process.env.GLAZELAB_WALKTHROUGH_OUT ?? join(OUTPUT, '..', 'glazelab-core-features.mp4');

const execute = promisify(execFile);

/**
 * The gatekeeper: the core journey of the app from sign-up to a published combination with a photo, each step asserted. Run it
 * after any UI or API change. With `E2E_VIDEO=1` (`npm run e2e:walkthrough`) the same steps are paced for a human viewer and
 * the recording is encoded as the phone clip.
 */
test('a new member signs up, adds a glaze, shelves it, publishes a combination with a photo and finds it in Explore @smoke', async ({
  page,
  shell,
  newApi,
  uid,
}) => {
  test.setTimeout(RECORDING ? 300_000 : 60_000);
  const pace = new Pace(page);
  await pace.start();
  const naming = new Naming(uid, RECORDING);
  const botz = naming.manufacturer('Botz');
  const nav = page.getByRole('navigation', { name: t('nav.label') });
  const main = page.getByRole('main');
  const me = { ...newAccount(uid, 'Ines'), displayName: 'Ines Okafor' };
  const title = 'Ash Blue over Celadon';
  const explore = new ExplorePage(page);
  // Other tests' data shares the server and fills the first page of Explore: a test run searches with its own `uid` too.
  const scoped = (text: string) => (RECORDING ? text : `${uid} ${text}`);

  // The library other potters built before this visitor arrives.
  await seedLibrary(newApi, naming, RECORDING ? 5 : 0);

  // A visitor lands on Explore, which already lists the shared combinations.
  await shell.open(RECORDING ? '#/' : `#/?q=${uid}`);
  await expect(explore.card(naming.title('Celadon over Shino White'))).toBeVisible();
  await shell.expectGuest();
  await pace.pause(2200);
  await pace.scroll(520);
  await pace.scroll(0);

  // Sign-up needs no mail: a password step follows and signs the member in.
  const auth = new AuthDialog(page);
  await pace.tap(shell.signInButton());
  await pace.pause();
  await pace.tap(auth.dialog.getByRole('button', { name: t('auth.register.switch') }));
  await pace.type(auth.dialog.getByLabel(t('auth.name')), me.displayName);
  await pace.type(auth.dialog.getByLabel(t('common.email')), me.email);
  await pace.pause(500);
  await pace.tap(auth.dialog.getByRole('button', { name: t('auth.register.submit') }));
  await expect(auth.setup).toBeVisible();
  await pace.pause();
  // The activation is where the terms are accepted.
  await pace.type(auth.setup.getByLabel(t('account.link.newPassword')), PASSWORD);
  await pace.type(auth.setup.getByLabel(t('account.link.confirmPassword')), PASSWORD);
  await pace.tap(auth.setup.getByLabel(t('auth.terms.accept')));
  await pace.tap(auth.setup.getByRole('button', { name: t('account.link.activate') }));
  await expect(auth.setup).toBeHidden();
  await shell.expectSignedIn(me.displayName);
  await expect(explore.card(naming.title('Celadon over Shino White'))).toBeVisible();
  await pace.pause(1800);

  // Search narrows the combinations; the Glazes view lists glazes, and a glaze page lists the combinations that use it.
  await pace.scroll(600);
  await pace.scroll(1300);
  await pace.scroll(0);
  await pace.type(explore.search, scoped('celadon'));
  await expect(explore.card(naming.title('Celadon over Shino White'))).toBeVisible();
  await expect(explore.card(naming.title('Tenmoku with Oatmeal rim'))).toHaveCount(0);
  await pace.pause(1800);
  await explore.search.clear();
  await pace.tap(explore.chip('discover.type.glazes'));
  await pace.pause(1400);
  await pace.type(explore.search, scoped('rutile'));
  await expect(explore.cards).toHaveCount(1);
  await pace.pause(1600);
  const rutile = explore.cards.getByRole('link', { name: 'Blue Rutile', exact: true });
  await expect(rutile).toBeVisible();
  await pace.tap(rutile);
  await expect(main.getByRole('heading', { name: 'Blue Rutile', exact: true })).toBeVisible();
  await expect(main.getByRole('heading', { name: naming.title('Seaweed and Blue Rutile pour'), exact: true })).toBeVisible();
  await pace.pause(1800);
  await pace.scroll(500);
  await pace.pause(1200);
  await pace.scroll(0);

  // A glaze of an existing manufacturer goes into the library and onto the shelf in one step.
  await page.goBack();
  await pace.pause(900);
  const add = new AddGlazeDialog(page);
  await pace.tap(main.getByRole('button', { name: t('addGlaze.action') }).first());
  // On the phone the scanner comes first; this clip enters the glaze by hand.
  if (await add.scanner.isVisible()) await pace.tap(add.scanner.getByRole('button', { name: t('addGlaze.withoutBarcode') }));
  await expect(add.dialog).toBeVisible();
  await pace.pause();
  await pace.type(add.dialog.getByRole('combobox', { name: t('glazeForm.manufacturer') }), botz);
  await pace.tap(page.getByRole('option', { name: new RegExp(botz) }).first());
  await pace.type(add.field('stock.newGlaze.name'), 'Ash Blue');
  await pace.type(add.field('stock.newGlaze.code'), 'AB-7');
  await pace.tap(add.dialog.getByLabel(t('glazeForm.shelf.have')));
  await pace.type(add.dialog.getByLabel(t('glazeForm.shelf.quantity')), '500');
  await pace.pause();
  await add.submit();
  const added = await add.expectAdded();
  await expect(added).toContainText(t('addGlaze.onShelf', { quantity: 500 }));
  await pace.pause(1800);
  await pace.tap(added.getByRole('link', { name: t('addGlaze.open') }));
  await expect(main.getByRole('heading', { name: 'Ash Blue', exact: true })).toBeVisible();
  await expect(main).toContainText(`${botz} AB-7`);
  await expect(main).toContainText('500');
  await pace.pause(2000);

  // Studio: a combination of a seeded glaze and the new one, published.
  await pace.tap(nav.getByRole('link', { name: t(shell.phone ? 'nav.record' : 'common.recordTest'), exact: true }));
  const studio = new StudioPage(page);
  await expect(studio.title).toBeVisible();
  await pace.pause();
  await pace.type(studio.title, naming.title(title));
  await studio.addGlazeStep(naming.glaze('Botz', 'CE-1'));
  await pace.pause();
  await studio.addGlazeStep(naming.glaze('Botz', 'AB-7'));
  await pace.pause(1400);
  await studio.publish();
  await expect(page.getByRole('heading', { level: 1, name: naming.title(title) })).toBeVisible();
  await expect(page).toHaveURL(/#\/combinations\/[0-9a-f-]{36}$/);
  await expect(main).toContainText('Celadon');
  await expect(main).toContainText('Ash Blue');
  // One action row under the recipe: a variation, Share and the author's Edit; the nav's Record is the only way to a new combination.
  await expect(main.getByRole('link', { name: t('combination.recordVariation') })).toBeVisible();
  await expect(main.getByRole('button', { name: t('share.action') })).toBeVisible();
  await expect(main.getByRole('link', { name: t('combination.edit'), exact: true })).toBeVisible();
  await expect(main.getByRole('link', { name: /another combination/i })).toHaveCount(0);
  await pace.pause(1800);

  // A test-tile photo on the new combination (no photo yet: the one green button, in the placeholder above the title).
  await pace.tap(main.getByRole('button', { name: t('images.addTestTile') }).first());
  const upload = page.getByRole('dialog', { name: t('upload.heading', { title: naming.title(title) }) });
  await expect(upload).toBeVisible();
  await pace.pause();
  await upload.getByLabel(t('upload.library')).setInputFiles(testTile('ash-blue.png', [96, 172, 160], [28, 78, 132], 0.01, 21));
  await pace.pause(1500);
  await pace.type(upload.getByLabel(t('images.details.caption')), 'First test, cone 6');
  // The API encodes one image at a time, and other tests upload meanwhile.
  await withEncoder(async () => {
    await pace.tap(upload.getByRole('button', { name: t('upload.submit', { count: 1 }) }));
    await expect(upload).toBeHidden();
  });
  await expect(page.getByRole('status').filter({ hasText: t('notices.photosAdded', { count: 1 }) })).toBeVisible();
  await expect(page.getByRole('img', { name: t('images.alt.tile', { title: naming.title(title) }) })).toBeVisible();
  await expect(main.getByText('First test, cone 6')).toBeVisible();
  await pace.pause(2400);
  await pace.scroll(500);
  await pace.pause(1200);
  await pace.scroll(0);

  // Explore lists the new combination among the others, and Mine only the member's own.
  await pace.tap(nav.getByRole('link', { name: t('nav.explore'), exact: true }));
  await pace.tap(explore.chip('discover.type.combinations'));
  if (!RECORDING) await explore.search.fill(uid);
  await expect(explore.card(naming.title(title))).toBeVisible();
  await expect(explore.card(naming.title('Celadon over Shino White'))).toBeVisible();
  await pace.pause(1800);
  await pace.scroll(700);
  await pace.pause(1200);
  await pace.scroll(0);
  await pace.tap(explore.chip('discover.quick.mine'));
  await expect(explore.cardTitles).toHaveText([naming.title(title)]);
  await pace.pause(2200);

  if (!RECORDING) return;
  // The clip: close the page so the recording is complete, then encode it for phones.
  const video = page.video();
  await page.close();
  if (!video) throw new Error('The run recorded no video');
  const raw = join(OUTPUT, 'raw-recording.webm');
  await video.saveAs(raw);
  await mkdir(dirname(CLIP), { recursive: true });
  await rm(CLIP, { force: true });
  await execute('ffmpeg', [
    ...['-hide_banner', '-loglevel', 'error', '-i', raw, '-ss', '1.0', '-vf', 'scale=780:1688:flags=lanczos,fps=30'],
    ...['-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', CLIP],
  ]);
});
