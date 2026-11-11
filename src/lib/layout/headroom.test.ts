import { afterEach, describe, expect, it, vi } from 'vitest';
import { routeHref } from '../routing/routes';
import { HEADROOM_TRAVEL, headroomStart, scrollTopOnSamePage, stepHeadroom, type Headroom } from './headroom';

const HEIGHT = 69;
/** Feeds the scroll positions in turn and answers the state after each. */
function run(positions: number[], frozen = false, from: Headroom = headroomStart): Headroom[] {
  const states: Headroom[] = [];
  let state = from;
  for (const y of positions) states.push((state = stepHeadroom(state, y, HEIGHT, frozen)));
  return states;
}

describe('stepHeadroom', () => {
  it('shows the header within its own height of the top, and above the top (iOS bounce)', () => {
    expect(run([0, 30, HEIGHT, -40]).map((state) => state.hidden)).toEqual([false, false, false, false]);
  });

  it('hides after HEADROOM_TRAVEL px of scrolling down beyond the header and shows after as many up', () => {
    const down = run([200, 200 + HEADROOM_TRAVEL - 1, 200 + HEADROOM_TRAVEL], false, { hidden: false, anchor: 200 });
    expect(down.map((state) => state.hidden)).toEqual([false, false, true]);
    const up = run([300, 300 - HEADROOM_TRAVEL + 1, 300 - HEADROOM_TRAVEL], false, down[2]);
    expect(up.map((state) => state.hidden)).toEqual([true, true, false]);
  });

  it('counts the run from where it turned, so a wobble never flips it', () => {
    const wobble = [400, 405, 400, 406, 401, 407, 402];
    expect(run(wobble, false, { hidden: false, anchor: 400 }).every((state) => !state.hidden)).toBe(true);
    const hidden = run([400, 420], false, headroomStart).at(-1)!;
    expect(hidden.hidden).toBe(true);
    expect(run([425, 420, 426, 421, 427], false, hidden).every((state) => state.hidden)).toBe(true);
    // Turning at 460 and back up by the travel shows it, whatever happened before.
    expect(run([460, 460 - HEADROOM_TRAVEL + 1, 460 - HEADROOM_TRAVEL], false, hidden).map((state) => state.hidden)).toEqual([true, true, false]);
  });

  it('while shown, counts the way down from the lowest point the page went up to', () => {
    // Up from 400 to 300 with the header shown, then down: it hides 12 px below 300, not 12 px below 400.
    const states = run([350, 300, 300 + HEADROOM_TRAVEL - 1, 300 + HEADROOM_TRAVEL], false, { hidden: false, anchor: 400 });
    expect(states.map((state) => state.hidden)).toEqual([false, false, false, true]);
  });

  it('takes a bounce past the end of the page (iOS) for the end, so springing back does not bring the header', () => {
    const hidden = stepHeadroom({ hidden: false, anchor: 900 }, 1000, HEIGHT, false, 1000);
    expect(hidden.hidden).toBe(true);
    const bounce = [1030, 1060, 1030, 1000].map((y) => stepHeadroom(hidden, y, HEIGHT, false, 1000));
    expect(bounce.every((state) => state.hidden && state.anchor === 1000)).toBe(true);
    // Scrolling up from the end still shows it after the travel.
    expect(stepHeadroom(hidden, 1000 - HEADROOM_TRAVEL, HEIGHT, false, 1000).hidden).toBe(false);
  });

  it('keeps its state while frozen, however far the page scrolls', () => {
    expect(run([200, 400, 800], true).every((state) => !state.hidden)).toBe(true);
    const hidden = run([200, 400]).at(-1)!;
    expect(run([300, 100 + HEIGHT + 1], true, hidden).every((state) => state.hidden)).toBe(true);
  });

  it('measures from where the freeze ended, not from where it began', () => {
    const frozen = run([200, 900], true).at(-1)!;
    expect(stepHeadroom(frozen, 900 + HEADROOM_TRAVEL - 1, HEIGHT, false).hidden).toBe(false);
    expect(stepHeadroom(frozen, 900 + HEADROOM_TRAVEL, HEIGHT, false).hidden).toBe(true);
  });

  it('shows the header again at the top even while frozen', () => {
    const hidden = run([200, 400]).at(-1)!;
    expect(stepHeadroom(hidden, 0, HEIGHT, true).hidden).toBe(false);
  });
});

describe('scrollTopOnSamePage', () => {
  const scrollTo = vi.fn();
  const click = (init: Partial<MouseEvent> = {}) => ({ button: 0, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...init }) as MouseEvent;
  const home = { name: 'discover' } as const;

  afterEach(() => {
    scrollTo.mockReset();
    vi.unstubAllGlobals();
  });
  const stub = (reduced: boolean) => {
    vi.stubGlobal('window', { scrollTo });
    vi.stubGlobal('matchMedia', () => ({ matches: reduced }));
  };

  it('scrolls to the top, smoothly, when the entry is the page already shown (also with filters set)', () => {
    stub(false);
    scrollTopOnSamePage(click(), home, home);
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'smooth' });
    scrollTopOnSamePage(click(), { name: 'discover', query: 'celadon' } as never, home);
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });

  it('jumps instead of gliding with reduced motion', () => {
    stub(true);
    scrollTopOnSamePage(click(), home, home);
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'instant' });
  });

  it('leaves another page to the navigation, which starts at the top itself', () => {
    stub(false);
    scrollTopOnSamePage(click(), { name: 'stock' } as never, home);
    scrollTopOnSamePage(click(), { name: 'glaze', id: 'g1' } as never, home);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(routeHref(home)).toBe('#/');
  });

  it('ignores a modified or non-primary click', () => {
    stub(false);
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }])
      scrollTopOnSamePage(click(init), home, home);
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
