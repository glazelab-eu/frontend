import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAddGlazeHost } from './add-glaze-host.svelte';
import type { AppState } from '../app/app-state';

const settle = () => new Promise((resolve) => setTimeout(resolve));

function setup() {
  const calls: string[] = [];
  const guards: { dirty: () => boolean; message: string }[] = [];
  const unregister = vi.fn();
  const app = {
    clearFormError: () => calls.push('clear'),
    registerLeaveGuard: (guard: { dirty: () => boolean; message: string }) => {
      guards.push(guard);
      return unregister;
    },
    openUpload: vi.fn(),
    addGlaze: vi.fn(),
  };
  let state = $state({
    user: { id: 'u1' },
    glazes: [{ id: 'g1', tags: ['matte'] }],
    combinations: [{ id: 'c1', tags: ['matte', 'blue'] }],
    clubs: [{ id: 'k1' }],
    online: true,
    formError: null as { form: string; message: string } | null,
  });
  let account = $state<string | undefined>('u1');
  let host!: ReturnType<typeof createAddGlazeHost<{ barcode?: string }>>;
  const stop = $effect.root(() => {
    host = createAddGlazeHost<{ barcode?: string }>(
      () => app as never,
      () => state as unknown as AppState,
      () => account,
    );
  });
  return {
    app,
    calls,
    guards,
    unregister,
    host,
    stop,
    state,
    setAccount: (id: string | undefined) => (account = id),
  };
}

let stop: (() => void) | undefined;
afterEach(() => stop?.());

describe('createAddGlazeHost', () => {
  it('opens for a target and clears the form error on open and on close', async () => {
    const s = setup();
    stop = s.stop;
    await settle();
    expect(s.host.target).toBeNull();
    s.host.open({ barcode: '4006381333931' });
    expect(s.host.target).toEqual({ barcode: '4006381333931' });
    expect(s.calls).toEqual(['clear']);
    s.host.close();
    expect(s.host.target).toBeNull();
    expect(s.calls).toEqual(['clear', 'clear']);
  });

  it('registers one leave guard that follows the bound dirty flag, and removes it on teardown', async () => {
    const s = setup();
    stop = s.stop;
    await settle();
    expect(s.guards).toHaveLength(1);
    expect(s.guards[0].message).toBe('drafts.discardGlaze');
    expect(s.guards[0].dirty()).toBe(false);
    s.host.open({});
    s.host.dirty = true;
    expect(s.host.dirty).toBe(true);
    expect(s.guards[0].dirty()).toBe(true);
    s.host.close();
    expect(s.guards[0].dirty()).toBe(false);
    expect(s.unregister).not.toHaveBeenCalled();
    s.stop();
    expect(s.unregister).toHaveBeenCalledTimes(1);
  });

  it('closes with its draft when the account changes, not before', async () => {
    const s = setup();
    stop = s.stop;
    await settle();
    s.host.open({ barcode: '1' });
    s.host.dirty = true;
    await settle();
    expect(s.host.target).toEqual({ barcode: '1' });
    s.setAccount('u2');
    await settle();
    expect(s.host.target).toBeNull();
    expect(s.host.dirty).toBe(false);
    s.host.open({});
    s.setAccount(undefined);
    await settle();
    expect(s.host.target).toBeNull();
  });

  it('suggests tags from published combinations only, never from the own drafts', async () => {
    const s = setup();
    stop = s.stop;
    await settle();
    s.state.combinations = [...s.state.combinations, { id: 'c2', tags: ['matte', 'wip'], draft: true } as never];
    expect(s.host.props.tagCounts).toEqual([
      { tag: 'matte', count: 2 },
      { tag: 'blue', count: 1 },
    ]);
  });

  it('shares the dialog props from the current state', async () => {
    const s = setup();
    stop = s.stop;
    await settle();
    expect(s.host.props).toMatchObject({
      accountId: 'u1',
      clubs: [{ id: 'k1' }],
      online: true,
      error: '',
      onSubmit: s.app.addGlaze,
      onAddPhoto: s.app.openUpload,
    });
    expect(s.host.props.tagCounts.map((c) => c.tag).sort()).toEqual(['blue', 'matte']);
    // A glaze added while the dialog is open brings its tags to the suggestions.
    s.state.glazes = [...s.state.glazes, { id: 'g2', tags: ['glossy'] }];
    expect(s.host.props.tagCounts.map((c) => c.tag).sort()).toEqual(['blue', 'glossy', 'matte']);
    s.state.formError = { form: 'glaze', message: 'Taken' };
    s.state.online = false;
    expect(s.host.props.error).toBe('Taken');
    expect(s.host.props.online).toBe(false);
    s.state.formError = { form: 'stock', message: 'Other' };
    expect(s.host.props.error).toBe('');
    s.host.open({});
    s.host.props.onClose();
    expect(s.host.target).toBeNull();
  });
});
