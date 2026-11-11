import { describe, expect, it } from 'vitest';
import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import AdminGate from './AdminGate.svelte';

const children = createRawSnippet(() => ({ render: () => '<p>the admin content</p>' }));
const shown = (siteAdmin: boolean, online: boolean) =>
  render(AdminGate, { props: { siteAdmin, online, adminOnlyText: 'admins only', offlineText: 'needs a connection', children } }).body;

/** The order of the admin pages' gate (COMP-6 review): not an admin first, offline next, then the content. */
describe('AdminGate', () => {
  it('tells a plain account the page is for admins, online or offline, and never shows the content', () => {
    for (const online of [true, false]) {
      const body = shown(false, online);
      expect(body).toContain('admins only');
      expect(body).not.toContain('needs a connection');
      expect(body).not.toContain('the admin content');
    }
  });

  it('tells an offline admin that the page needs a connection, without the content', () => {
    const body = shown(true, false);
    expect(body).toContain('needs a connection');
    expect(body).not.toContain('admins only');
    expect(body).not.toContain('the admin content');
  });

  it('shows an online admin the content only', () => {
    const body = shown(true, true);
    expect(body).toContain('the admin content');
    expect(body).not.toContain('admins only');
    expect(body).not.toContain('needs a connection');
  });

  it('counts a page without an offline state as online', () => {
    const body = render(AdminGate, { props: { siteAdmin: true, adminOnlyText: 'admins only', children } }).body;
    expect(body).toContain('the admin content');
  });
});
