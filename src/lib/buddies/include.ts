/**
 * The "Include buddies" switch shared by Available to me and I can make now: off by default and remembered per account on this device, like the
 * dismissal of Explore's intro card. The value is only '1'; a missing key, an unreadable storage or anything else is off.
 */
type DeviceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const includeBuddiesKey = (accountId: string) => 'glazelab:include-buddies:' + accountId;

export function readIncludeBuddies(accountId: string, storage?: DeviceStorage): boolean {
  try {
    return (storage ?? globalThis.localStorage).getItem(includeBuddiesKey(accountId)) === '1';
  } catch {
    return false;
  }
}

/** Remembers the choice; the caller keeps it in memory even when this optional write fails. Off removes the key. */
export function rememberIncludeBuddies(accountId: string, on: boolean, storage?: DeviceStorage): void {
  try {
    const store = storage ?? globalThis.localStorage;
    if (on) store.setItem(includeBuddiesKey(accountId), '1');
    else store.removeItem(includeBuddiesKey(accountId));
  } catch {
    // The choice then holds for this page's session only.
  }
}

/**
 * "Include club glazes" of the two availability views: off by default, remembered per account on this device like the buddies switch
 * (the link's explicit `clubs=1|0` wins). Same value rules: only '1' is on.
 */
export const includeClubsKey = (accountId: string) => 'glazelab:include-clubs:' + accountId;

export function readIncludeClubs(accountId: string, storage?: DeviceStorage): boolean {
  try {
    return (storage ?? globalThis.localStorage).getItem(includeClubsKey(accountId)) === '1';
  } catch {
    return false;
  }
}

/** Remembers the choice; off removes the key. */
export function rememberIncludeClubs(accountId: string, on: boolean, storage?: DeviceStorage): void {
  try {
    const store = storage ?? globalThis.localStorage;
    if (on) store.setItem(includeClubsKey(accountId), '1');
    else store.removeItem(includeClubsKey(accountId));
  } catch {
    // The choice then holds for this page's session only.
  }
}
