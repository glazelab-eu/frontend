import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { createInstallController } from './install';

let events: EventTarget;
let display: EventTarget & { matches: boolean };
let values: Map<string, string>;
let stop: (() => void) | undefined;

beforeEach(() => {
  events = new EventTarget();
  display = Object.assign(new EventTarget(), { matches: false });
  values = new Map();
  vi.stubGlobal('window', Object.assign(events, { matchMedia: () => display }));
  vi.stubGlobal('navigator', { userAgent: 'Chromium', platform: 'Linux', maxTouchPoints: 0 });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
});
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.unstubAllGlobals();
});

function started() {
  const install = createInstallController();
  stop = install.start();
  return install;
}
function prompt(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt: vi.fn(async () => {}),
    userChoice: Promise.resolve({ outcome }),
  });
  events.dispatchEvent(event);
  return event;
}

describe('PWA installation', () => {
  it('keeps the invitation hidden on load and before a native prompt', () => {
    const install = started();
    expect(get(install.state)).toMatchObject({
      installed: false,
      invitation: false,
      canPrompt: false,
    });
    const event = prompt();
    expect(event.defaultPrevented).toBe(true);
    expect(get(install.state).invitation).toBe(false);
    install.open();
    expect(get(install.state)).toMatchObject({ open: true, invitation: false, canPrompt: true });
    expect(event.prompt).not.toHaveBeenCalled();
  });

  it('invites after the first save and keeps the offer in memory for this session only', () => {
    const install = started();
    install.offer();
    expect(get(install.state).invitation).toBe(true);
    prompt();
    expect(get(install.state).invitation).toBe(true);
    expect(values.size).toBe(0);
    stop?.();
    expect(get(started().state).invitation).toBe(false);
  });

  it('never reopens details or overrides a decline after a save', () => {
    const install = started();
    install.open();
    install.offer();
    expect(get(install.state)).toMatchObject({ open: true, invitation: false });
    install.decline();
    install.offer();
    prompt();
    expect(get(install.state)).toMatchObject({ open: false, invitation: false });
  });

  it('only prompts after the install action and consumes each event once', async () => {
    const install = started();
    const event = prompt();
    install.open();
    const pending = install.install();
    await install.install();
    await pending;
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(get(install.state)).toMatchObject({
      installed: true,
      invitation: false,
      open: false,
      canPrompt: false,
      busy: false,
    });
    install.open();
    expect(get(install.state).open).toBe(false);
  });

  it('remembers a decline while allowing manual installation later', async () => {
    const install = started();
    const event = prompt();
    install.decline();
    expect(event.prompt).not.toHaveBeenCalled();
    stop?.();
    const next = started();
    expect(get(next.state)).toMatchObject({ installed: false, invitation: false });
    const offered = prompt();
    expect(get(next.state).invitation).toBe(false);
    next.open();
    await next.install();
    expect(offered.prompt).toHaveBeenCalledOnce();
  });

  it('remembers dismissal of the browser confirmation', async () => {
    const install = started();
    prompt('dismissed');
    install.open();
    await install.install();
    expect(get(install.state)).toMatchObject({
      installed: false,
      open: false,
      busy: false,
      invitation: false,
    });
    stop?.();
    expect(get(started().state).invitation).toBe(false);
  });

  it.each(['display', 'ios'] as const)('never offers installation in %s standalone mode', (mode) => {
    if (mode === 'display') display.matches = true;
    else
      vi.stubGlobal('navigator', {
        standalone: true,
        userAgent: 'iPhone',
        platform: 'iPhone',
        maxTouchPoints: 1,
      });
    const install = started();
    const event = prompt();
    install.offer();
    install.open();
    expect(get(install.state)).toMatchObject({
      installed: true,
      invitation: false,
      open: false,
      canPrompt: false,
    });
    expect(event.prompt).not.toHaveBeenCalled();
  });

  it('closes the invitation and dialog after an external installation or display-mode change', () => {
    const install = started();
    install.open();
    events.dispatchEvent(new Event('appinstalled'));
    expect(get(install.state)).toMatchObject({ installed: true, invitation: false, open: false });
    display.matches = true;
    display.dispatchEvent(new Event('change'));
    expect(get(install.state).installed).toBe(true);
  });

  it.each(['native confirmation', 'appinstalled event'])('no longer invites in the browser tab after installation by %s', async (how) => {
    const install = started();
    if (how === 'native confirmation') {
      prompt('accepted');
      install.open();
      await install.install();
    } else events.dispatchEvent(new Event('appinstalled'));
    stop?.();
    // Reloaded in the (non-standalone) browser tab: the header entry stays, the invitation not.
    const reloaded = started();
    expect(get(reloaded.state)).toMatchObject({ installed: false, invitation: false });
    reloaded.open();
    expect(get(reloaded.state).open).toBe(true);
  });

  it.each([
    { userAgent: 'iPhone', platform: 'iPhone', maxTouchPoints: 1 },
    { userAgent: 'Safari', platform: 'MacIntel', maxTouchPoints: 5 },
  ])('selects iOS instructions for $platform', (navigator) => {
    vi.stubGlobal('navigator', navigator);
    expect(get(started().state).ios).toBe(true);
  });

  it('falls back to instructions if the native prompt fails', async () => {
    const install = started();
    const event = prompt();
    event.prompt.mockRejectedValue(new Error('Unavailable'));
    install.open();
    await install.install();
    expect(get(install.state)).toMatchObject({
      open: true,
      failed: true,
      busy: false,
      canPrompt: false,
    });
  });

  it('retains a decline in memory when preference storage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('Disabled');
      },
      setItem: () => {
        throw new Error('Disabled');
      },
    });
    const install = started();
    install.decline();
    prompt();
    expect(get(install.state).invitation).toBe(false);
    install.open();
    expect(get(install.state).open).toBe(true);
  });

  it('removes event listeners on unmount and drops pending native results', async () => {
    const install = started();
    let finish!: (choice: { outcome: 'accepted' }) => void;
    const event = prompt();
    event.userChoice = new Promise((resolve) => {
      finish = resolve;
    });
    install.open();
    const pending = install.install();
    stop?.();
    finish({ outcome: 'accepted' });
    await pending;
    events.dispatchEvent(new Event('appinstalled'));
    expect(get(install.state).installed).toBe(false);
  });
});
