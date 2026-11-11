import { describe, expect, it } from 'vitest';
import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import RecordList from './RecordList.svelte';

const children = createRawSnippet(() => ({ render: () => '<li>an entry</li>' }));
const list = (props: { busy: boolean; focusable?: boolean }) => render(RecordList, { props: { class: 'bans', ...props, children } }).body;

/** The admin lists' container (COMP-6 review): a list that says when it loads, and a focus target only where a page asks for one. */
describe('RecordList', () => {
  it('marks the list busy while a page loads, and only then', () => {
    expect(list({ busy: true })).toContain('aria-busy="true"');
    expect(list({ busy: false })).toContain('aria-busy="false"');
  });

  it('takes the focus (tabindex -1, never a tab stop) only when focusable', () => {
    expect(list({ busy: false, focusable: true })).toMatch(/<ul[^>]*tabindex="-1"/);
    expect(list({ busy: false })).not.toContain('tabindex');
  });

  it('keeps the page block name beside its own for the e2e suite', () => {
    expect(list({ busy: false })).toMatch(/<ul class="record-list bans[ "]/);
  });
});
