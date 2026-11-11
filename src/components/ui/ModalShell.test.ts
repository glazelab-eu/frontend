import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { createRawSnippet } from 'svelte';
import ModalShell from './ModalShell.svelte';

const children = createRawSnippet(() => ({ render: () => '<p>Body</p>' }));
const dialogTag = (html: string) => html.match(/<div[^>]*role="dialog"[^>]*>/)![0];

describe('ModalShell heading', () => {
  it('renders the title as the h2 before the content and names the dialog by it', () => {
    const html = render(ModalShell, { props: { title: 'Change password', eyebrow: 'Account', onClose: () => {}, children } }).body;
    const id = dialogTag(html).match(/aria-labelledby="([^"]+)"/)![1];
    expect(dialogTag(html)).not.toContain('aria-label=');
    expect(html).toMatch(new RegExp(`<h2[^>]*class="modal__title[^"]*"[^>]*id="${id}"[^>]*>\\s*Change password\\s*</h2>`));
    // The eyebrow stands above the heading, outside the dialog's name.
    expect(html).toMatch(/<div class="eyebrow modal__eyebrow[^"]*">Account<\/div>/);
    expect(html.indexOf('Account')).toBeLessThan(html.indexOf('<h2'));
    expect(html.indexOf('<h2')).toBeLessThan(html.indexOf('Body'));
  });

  it('without a title takes its name from ariaLabel and renders no heading', () => {
    const html = render(ModalShell, { props: { ariaLabel: 'Photo viewer', children } }).body;
    expect(dialogTag(html)).toContain('aria-label="Photo viewer"');
    expect(dialogTag(html)).not.toContain('aria-labelledby');
    expect(html).not.toContain('<h2');
  });
});
