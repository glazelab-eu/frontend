import { beforeAll, describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { createRawSnippet } from 'svelte';
import { get } from 'svelte/store';
import { setLocale, t, type MessageKey } from '../../lib/i18n';
import ConfirmDialog from './ConfirmDialog.svelte';
import RemoveCombinationDialog from '../combinations/RemoveCombinationDialog.svelte';
import RemoveGlazeDialog from '../glazes/RemoveGlazeDialog.svelte';
import RemoveImageDialog from '../images/RemoveImageDialog.svelte';

const noop = () => {};
const yes = async () => true;
const body = createRawSnippet(() => ({ render: () => '<p>The body.</p>' }));
const base = { title: 'Remove it?', confirmLabel: 'Remove', onConfirm: noop, onCancel: noop, children: body };
const text = (key: MessageKey) => get(t)(key);
/** The rendered `<button>` tags, in document order. */
const buttons = (html: string) => [...html.matchAll(/<button\b[^>]*>/g)].map((match) => match[0]);
const confirmButton = (html: string) => buttons(html).at(-1)!;

beforeAll(() => setLocale('en'));

describe('ConfirmDialog', () => {
  it('names the dialog by its heading and puts Cancel first and the danger confirm last', () => {
    const { body: html } = render(ConfirmDialog, { props: base });
    const named = html.match(/aria-labelledby="([^"]+)"/)?.[1];
    expect(named).toBeTruthy();
    expect(html).toMatch(new RegExp(`<h2[^>]*id="${named}"[^>]*>\\s*Remove it\\?\\s*</h2>`));
    expect(html.indexOf('The body.')).toBeGreaterThan(html.indexOf('<h2'));
    expect(html.indexOf(text('common.cancel'))).toBeLessThan(html.lastIndexOf('Remove'));
    expect(confirmButton(html)).toContain('button--danger');
    expect(confirmButton(html)).not.toContain('disabled');
    expect(html).not.toContain(text('forms.offline'));
  });

  it('offline shows the note above the disabled confirm', () => {
    const { body: html } = render(ConfirmDialog, { props: { ...base, online: false } });
    const note = html.indexOf(text('forms.offline'));
    expect(note).toBeGreaterThan(-1);
    expect(note).toBeLessThan(html.lastIndexOf('<button'));
    expect(confirmButton(html)).toContain('disabled');
    expect(buttons(html).at(-2)).not.toContain('disabled');
  });

  it('offline says what the host asks it to say', () => {
    const { body: html } = render(ConfirmDialog, { props: { ...base, online: false, offlineMessage: 'Connect first.' } });
    expect(html).toContain('Connect first.');
    expect(html).not.toContain(text('forms.offline'));
  });

  it('busy keeps both buttons waiting', () => {
    const { body: html } = render(ConfirmDialog, { props: { ...base, busy: true } });
    expect(
      buttons(html)
        .slice(-2)
        .every((button) => button.includes('disabled')),
    ).toBe(true);
    expect(confirmButton(html)).toContain('aria-busy="true"');
  });

  it('a disabled confirm leaves Cancel usable, and a constructive confirm is primary', () => {
    const { body: html } = render(ConfirmDialog, { props: { ...base, confirmDisabled: true, danger: false } });
    expect(confirmButton(html)).toContain('disabled');
    expect(confirmButton(html)).toContain('button--primary');
    expect(buttons(html).at(-2)).not.toContain('disabled');
  });

  it('shows the error as an alert above the buttons', () => {
    const { body: html } = render(ConfirmDialog, { props: { ...base, error: 'Please sign in.' } });
    const alert = html.search(/role="alert"/);
    expect(alert).toBeGreaterThan(-1);
    expect(alert).toBeLessThan(html.lastIndexOf('<button'));
  });
});

describe('the confirm dialogs offline', () => {
  const offline: { name: string; html: () => string; note: MessageKey }[] = [
    {
      name: 'RemoveCombinationDialog',
      html: () => render(RemoveCombinationDialog, { props: { title: 'Tile', locked: false, online: false, error: '', onConfirm: yes, onClose: noop } }).body,
      note: 'forms.offline',
    },
    {
      name: 'RemoveGlazeDialog',
      html: () => render(RemoveGlazeDialog, { props: { label: 'G1', usedIn: [], online: false, error: '', onConfirm: yes, onClose: noop } }).body,
      note: 'forms.offline',
    },
    {
      name: 'RemoveImageDialog',
      html: () =>
        render(RemoveImageDialog, { props: { online: false, error: '', description: 'a', focusFallback: undefined, onConfirm: yes, onClose: noop } }).body,
      note: 'images.menu.offline',
    },
  ];
  it.each(offline)('$name shows its offline note above the disabled confirm', ({ html, note }) => {
    const rendered = html();
    const at = rendered.indexOf(text(note));
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(rendered.lastIndexOf('<button'));
    expect(confirmButton(rendered)).toContain('disabled');
  });
});
