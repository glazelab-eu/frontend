import { get, readonly, writable } from 'svelte/store';

interface InstallEvent extends Event {
  prompt(): Promise<unknown>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface InstallState {
  installed: boolean;
  invitation: boolean;
  open: boolean;
  canPrompt: boolean;
  busy: boolean;
  failed: boolean;
  ios: boolean;
}

const declineKey = 'glazelab:install-declined';

/** Device installation has its own lifecycle, independent of account/server state. */
export function createInstallController() {
  const state = writable<InstallState>({
    installed: false,
    invitation: false,
    open: false,
    canPrompt: false,
    busy: false,
    failed: false,
    ios: false,
  });
  const patch = (changes: Partial<InstallState>) => state.update((value) => ({ ...value, ...changes }));
  let deferred: InstallEvent | null = null;
  let declined = false;
  let active = false;
  let eligible = false;

  /** A successful save or favourite is the first meaningful moment to invite this session. */
  function offer() {
    eligible = true;
    if (active && !declined && !get(state).installed && !get(state).open) patch({ invitation: true });
  }

  /** No further invitations: after a decline, or once installed (the browser tab is not standalone). */
  function remember() {
    declined = true;
    try {
      localStorage.setItem(declineKey, '1');
    } catch {
      /* The in-memory choice still applies. */
    }
  }

  function installed() {
    deferred = null;
    remember();
    patch({ installed: true, invitation: false, open: false, canPrompt: false, busy: false });
  }

  function decline() {
    if (get(state).busy) return;
    remember();
    patch({ invitation: false, open: false, failed: false });
  }

  function start() {
    active = true;
    try {
      declined = localStorage.getItem(declineKey) === '1';
    } catch {
      /* Optional preference. */
    }
    const display = window.matchMedia('(display-mode: standalone)');
    const standalone = () => display.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const syncDisplay = () => {
      if (standalone()) installed();
      else patch({ installed: false, invitation: eligible && !declined });
    };
    patch({
      ios: /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
    });
    syncDisplay();
    const beforeInstall = (event: Event) => {
      event.preventDefault();
      if (get(state).installed) return;
      deferred = event as InstallEvent;
      patch({
        canPrompt: true,
        invitation: eligible && !declined && !get(state).open,
        failed: false,
      });
    };
    window.addEventListener('beforeinstallprompt', beforeInstall);
    window.addEventListener('appinstalled', installed);
    display.addEventListener('change', syncDisplay);
    return () => {
      active = false;
      deferred = null;
      window.removeEventListener('beforeinstallprompt', beforeInstall);
      window.removeEventListener('appinstalled', installed);
      display.removeEventListener('change', syncDisplay);
    };
  }

  function open() {
    if (!get(state).installed) patch({ open: true, invitation: false, failed: false });
  }

  async function install() {
    if (!deferred || get(state).busy || get(state).installed) return;
    const event = deferred;
    deferred = null; // Each browser event can only be used once.
    patch({ busy: true, canPrompt: false, failed: false });
    try {
      await event.prompt(); // Called directly from the click, preserving user activation.
      const choice = await event.userChoice;
      if (!active || get(state).installed) return;
      patch({ busy: false });
      if (choice.outcome === 'accepted') installed();
      else decline();
    } catch {
      if (active && !get(state).installed) patch({ failed: true });
    } finally {
      if (active) patch({ busy: false });
    }
  }

  return { state: readonly(state), start, open, decline, install, offer };
}
