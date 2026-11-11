import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudioContent } from '../../lib/studio/recovery';

const storage = vi.hoisted(() => ({
  saved: [] as { owner: string; route: string; title: string; revision: string }[],
  deleted: [] as { owner: string; route: string; revision: string }[],
}));
vi.mock('../../lib/offline/snapshots', () => ({
  readStudioRecovery: async () => undefined,
  saveStudioRecovery: async (owner: string, route: string, value: { revision: string; content: StudioContent }) => {
    storage.saved.push({ owner, route, title: value.content.title, revision: value.revision });
  },
  deleteStudioRecovery: async (owner: string, route: string, revision: string) => {
    storage.deleted.push({ owner, route, revision });
  },
}));
// No component here: the lifetime follows the account alone.
vi.mock('../shared/lifetime', () => ({
  lifetime: (account: () => string | undefined) => ({ mounted: () => true, current: (actor: string | undefined) => account() === actor }),
}));

const { RECOVERY_DELAY_MS, createStudioRecovery } = await import('./recovery.svelte');

const content = (title: string): StudioContent => ({
  title,
  description: '',
  tags: [],
  tagText: '',
  steps: [],
  firing: { cone: '', temperature: '', unit: 'C', atmosphere: '', notes: '' } as unknown as StudioContent['firing'],
});

/** Effects outside a component run in a microtask (`flushSync` of the server build Vitest resolves does nothing). */
const effects = () => vi.advanceTimersByTimeAsync(0);

describe('createStudioRecovery writes', () => {
  let stop: (() => void) | undefined;
  let visibility: DocumentVisibilityState;
  beforeEach(() => {
    vi.useFakeTimers();
    visibility = 'visible';
    vi.stubGlobal('document', Object.defineProperty(new EventTarget(), 'visibilityState', { get: () => visibility }));
    vi.stubGlobal('window', new EventTarget());
    storage.saved = [];
    storage.deleted = [];
  });
  afterEach(() => {
    stop?.();
    stop = undefined;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function setup() {
    let account = $state<string | undefined>('u1');
    let title = $state('');
    let recovery!: ReturnType<typeof createStudioRecovery>;
    stop = $effect.root(() => {
      recovery = createStudioRecovery({
        account: () => account,
        route: () => '#/studio',
        ready: () => true,
        dirty: () => title !== '',
        content: () => content(title),
      });
    });
    // The read before any write.
    while (recovery.checking) await Promise.resolve();
    await effects();
    return {
      recovery,
      type: async (value: string) => {
        title = value;
        await effects();
      },
      setAccount: async (value: string | undefined) => {
        account = value;
        await effects();
      },
    };
  }

  it('waits for a pause in typing and then writes the latest fields once', async () => {
    const s = await setup();
    await s.type('B');
    await s.type('Bl');
    await s.type('Blue');
    expect(storage.saved).toEqual([]);
    await vi.advanceTimersByTimeAsync(RECOVERY_DELAY_MS);
    expect(storage.saved.map((entry) => entry.title)).toEqual(['Blue']);
  });

  it('writes at once when the page is hidden or left', async () => {
    const s = await setup();
    await s.type('Blue');
    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    visibility = 'visible';
    expect(storage.saved.map((entry) => entry.title)).toEqual(['Blue']);
    await s.type('Blue glaze');
    window.dispatchEvent(new Event('pagehide'));
    expect(storage.saved.map((entry) => entry.title)).toEqual(['Blue', 'Blue glaze']);
    await vi.advanceTimersByTimeAsync(RECOVERY_DELAY_MS * 2);
    expect(storage.saved).toHaveLength(2);
  });

  it('clear drops a write still waiting and removes only the revision it wrote', async () => {
    const s = await setup();
    await s.type('Blue');
    await vi.advanceTimersByTimeAsync(RECOVERY_DELAY_MS);
    await s.type('Blue glaze');
    await s.recovery.clear();
    await vi.advanceTimersByTimeAsync(RECOVERY_DELAY_MS * 2);
    expect(storage.saved.map((entry) => entry.title)).toEqual(['Blue']);
    expect(storage.deleted).toEqual([{ owner: 'u1', route: '#/studio', revision: storage.saved[0].revision }]);
  });

  it('never writes a waiting recovery for an account that signed out', async () => {
    const s = await setup();
    await s.type('Blue');
    await s.setAccount(undefined);
    await vi.advanceTimersByTimeAsync(RECOVERY_DELAY_MS * 2);
    window.dispatchEvent(new Event('pagehide'));
    expect(storage.saved).toEqual([]);
  });

  it('writes a waiting recovery when Studio unmounts', async () => {
    const s = await setup();
    await s.type('Blue');
    stop?.();
    stop = undefined;
    expect(storage.saved.map((entry) => entry.title)).toEqual(['Blue']);
  });
});
