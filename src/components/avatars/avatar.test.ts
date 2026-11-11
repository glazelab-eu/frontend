import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Avatar from './Avatar.svelte';

/** Server-rendered: no effect runs, so this is what shows before (or without) a picture: the initial letter, never an image. */
describe('Avatar before and without a picture', () => {
  it('shows the first letter of the name, upper case, whole for an emoji', () => {
    expect(render(Avatar, { props: { avatarId: null, name: 'ana', viewerId: 'u1' } }).body).toContain('A');
    expect(render(Avatar, { props: { avatarId: null, name: '  😀 Bo', viewerId: 'u1' } }).body).toContain('😀');
  });

  it('asks for no image while there is none, and none before it is loaded', () => {
    expect(render(Avatar, { props: { avatarId: null, name: 'Ana', viewerId: 'u1' } }).body).not.toContain('<img');
    expect(render(Avatar, { props: { avatarId: 'a1', name: 'Ana', viewerId: 'u1' } }).body).not.toContain('<img');
  });

  it('is decorative (hidden from assistive technology) by default, as the name stands beside it', () => {
    const body = render(Avatar, { props: { avatarId: null, name: 'Ana', viewerId: 'u1' } }).body;
    expect(body).toContain('aria-hidden="true"');
    expect(body).not.toContain('role="img"');
  });

  it('names itself when it is not decorative, by the name or by a given label', () => {
    expect(render(Avatar, { props: { avatarId: null, name: 'Ana', viewerId: 'u1', decorative: false } }).body).toContain('role="img" aria-label="Ana"');
    expect(render(Avatar, { props: { avatarId: null, name: 'Ana', viewerId: 'u1', decorative: false, label: 'Your picture' } }).body).toContain(
      'aria-label="Your picture"',
    );
  });

  it('has the size class asked for', () => {
    for (const size of ['sm', 'md', 'lg', 'fill'] as const) {
      expect(render(Avatar, { props: { avatarId: null, name: 'Ana', viewerId: 'u1', size } }).body).toContain(`avatar--${size}`);
    }
  });
});
