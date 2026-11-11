/**
 * The per-device choice about the photo suggestions (33-1): a UI preference like the language, never sent anywhere. Absent
 * means never asked; `on` means the writer agreed to download and run the model here; `off` means they said "Not now" or
 * turned it off, so the app does not ask again until they open the setting. Signing out does not change it (it is the
 * device's, not an account's).
 */
export const PREFERENCE_KEY = 'glazelab:photo-suggestions';

export type Preference = 'on' | 'off' | null;

export function readPreference(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): Preference {
  try {
    const value = storage?.getItem(PREFERENCE_KEY);
    return value === 'on' || value === 'off' ? value : null;
  } catch {
    return null;
  }
}

/** Writes the choice; false when the browser refuses storage (the choice then lasts until the page closes). */
export function writePreference(value: 'on' | 'off', storage: Pick<Storage, 'setItem'> | undefined = safeStorage()): boolean {
  try {
    storage?.setItem(PREFERENCE_KEY, value);
    return storage !== undefined;
  } catch {
    return false;
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** A connection the writer may pay for by the megabyte: Data Saver is on, or the browser says it is cellular. */
export function isMetered(connection: { saveData?: boolean; type?: string } | undefined): boolean {
  return connection?.saveData === true || connection?.type === 'cellular';
}

/** Whether this device's connection looks metered right now (`isMetered` of the browser's own Network Information, where there is one). */
export const meteredNow = () =>
  isMetered((globalThis.navigator as (Navigator & { connection?: { saveData?: boolean; type?: string } }) | undefined)?.connection);

/**
 * The speed check after the download: one photo took this long; slower than this is "slow". Derived from the shipped model's
 * measurements (docs/vision-check.md): its first run takes 0.25 to 0.5 s on a desktop and 1.0 to 1.9 s with the main thread slowed
 * 4x to 6x (a phone class), so 3 s is a device that is slower than that.
 */
export const SLOW_MS = 3000;
export const isSlow = (milliseconds: number) => milliseconds > SLOW_MS;
