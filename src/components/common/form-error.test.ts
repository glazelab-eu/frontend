import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import FormError from './FormError.svelte';
import { setLocale } from '../../lib/i18n';
import { dictionaries } from '../../test/dictionaries';

/** Server-rendered (no effect runs, so no focus): the text and the alert box of each kind of message. */
describe('FormError', () => {
  it('shows nothing without a message', () => {
    expect(render(FormError, { props: { message: '' } }).body).not.toContain('role="alert"');
  });

  it('translates a known server message and a message key in an alert', () => {
    const server = render(FormError, { props: { message: 'Incorrect password. Your account was not deleted.' } }).body;
    expect(server).toContain('role="alert"');
    expect(server).toContain('Incorrect password. Your account was not deleted.');
    expect(render(FormError, { props: { message: 'account.avatar.problem.notImage' } }).body).toContain('role="alert"');
  });

  it('fills the placeholders of a key from its values', () => {
    const body = render(FormError, { props: { message: 'account.avatar.problem.tooSmall', values: { min: 64 } } }).body;
    expect(body).toContain('64');
    expect(body).not.toContain('{min}');
  });

  afterEach(() => setLocale('en'));

  it("fills the refused files' limits in every language (COMP-7 review)", async () => {
    for (const language of ['en', 'de', 'pt-PT', 'it', 'es'] as const) {
      await setLocale(language);
      for (const [key, values, shown] of [
        ['account.avatar.problem.tooLarge', { max: 40 }, '40 MB'],
        ['account.avatar.problem.tooManyPixels', { max: 50 }, '50'],
        ['account.avatar.problem.tooSmall', { min: 64 }, '64'],
      ] as const) {
        const body = render(FormError, { props: { message: key, values } }).body;
        expect(body, `${language} ${key}`).toContain(dictionaries[language][key].replace(/\{\w+\}/, String(Object.values(values)[0])));
        expect(body, `${language} ${key}`).toContain(shown);
        expect(body, `${language} ${key}`).not.toMatch(/\{\w+\}/);
      }
    }
  });

  it('never shows an unknown text as it came', () => {
    expect(render(FormError, { props: { message: 'internal detail', values: { min: 64 } } }).body).not.toContain('internal detail');
  });
});
