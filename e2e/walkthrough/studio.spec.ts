import { t } from '../support/i18n';
import { testTile } from '../support/tiles';
import { expect, test } from './support';

/** Studio: record a combination (title, glaze picker, steps, coats, methods, final firing), publish it and add a photo. */
test('studio: record a combination with steps, coats, firing and a photo', async ({ page, begin, finish, human, signIn }) => {
  await signIn();
  const main = page.getByRole('main');
  await begin('#/studio', (p) => p.getByLabel(t('studio.titleLabel')).waitFor());

  await human.type(main.getByLabel(t('studio.titleLabel')), 'Sage over Oatmeal, thin');
  await human.tryStep('description', async () => {
    await human.type(main.getByPlaceholder(t('studio.notesPlaceholder')), 'Two dips, a soft green break over a warm cream.');
  });

  // Step 1: a glaze from the picker, three coats, dipped.
  await human.tap(main.getByRole('button', { name: t('studio.addGlazeStep') }));
  const picker = main.getByRole('combobox', { name: t('common.glaze') }).last();
  await human.type(picker, 'oatmeal');
  await human.tap(page.getByRole('option').first());
  await human.tryStep('coats', async () => {
    await human.tap(main.getByRole('button', { name: t('studio.step.coatsMore') }).last());
    await human.tap(main.getByRole('button', { name: t('studio.step.coatsMore') }).last());
  });
  await human.tryStep('method', async () => {
    await human.tap(main.getByRole('button', { name: t('studio.step.method.dip'), exact: true }).last());
  });

  // Step 2: another glaze, brushed.
  await human.tap(main.getByRole('button', { name: t('studio.addGlazeStep') }));
  await human.type(main.getByRole('combobox', { name: t('common.glaze') }).last(), 'sage');
  await human.tap(page.getByRole('option').first());
  await human.tryStep('method 2', async () => {
    await human.tap(main.getByRole('button', { name: t('studio.step.method.brush'), exact: true }).last());
  });
  await human.tryStep('step notes', async () => {
    await human.type(main.getByPlaceholder(t('studio.step.notesPlaceholder')).last(), 'Thick on the rim');
  });

  // A custom step.
  await human.tryStep('custom step', async () => {
    await human.tap(main.getByRole('button', { name: t('studio.addCustomStep') }));
    await human.tap(main.getByRole('button', { name: t('studio.step.chip.glaze'), exact: true }).last());
  });
  await human.browse(1, 500);

  // The final firing.
  await human.tryStep('firing', async () => {
    await human.tap(main.getByRole('button', { name: new RegExp(t('firing.title')) }).first());
    await human.type(main.getByPlaceholder(t('firing.conePlaceholder')), '6');
    await main.getByLabel(t('firing.atmosphere')).selectOption({ index: 1 });
    await human.type(main.getByPlaceholder(t('firing.clayBodyPlaceholder')), 'Speckled stoneware');
    await human.type(main.getByPlaceholder(t('firing.kilnPlaceholder')), 'Riverside electric kiln');
  });
  await human.browse(1, 500);

  // Publish, then add a test-tile photo.
  await human.tap(main.getByRole('button', { name: t('combination.publish'), exact: true }));
  await page.waitForTimeout(2500);
  await expect(page.getByRole('heading', { level: 1, name: 'Sage over Oatmeal, thin' })).toBeVisible();
  await human.pause(2000);
  await human.tryStep('photo', async () => {
    await human.tap(main.getByRole('button', { name: t('images.addTestTile') }).first());
    const upload = page.getByRole('dialog', { name: t('upload.heading', { title: 'Sage over Oatmeal, thin' }) });
    await expect(upload).toBeVisible();
    await human.pause(1200);
    await upload.getByLabel(t('upload.library')).setInputFiles(testTile('sage-oatmeal.png', [152, 170, 128], [214, 196, 160], 0.012, 4));
    await human.pause(1500);
    await human.type(upload.getByLabel(t('images.details.caption')), 'First test, cone 6');
    await human.tap(upload.getByRole('button', { name: t('upload.submit', { count: 1 }) }));
    await expect(upload).toBeHidden();
    await human.pause(2500);
  });
  await finish('studio');
});
