import type { Combination, StockItem, User } from '../api/models';
import type { DiscoverRoute, Route } from '../routing/routes';

export interface IntroStep {
  kind: 'shelf' | 'combination' | 'club' | 'picture' | 'diagnostics';
  complete: boolean;
  route: Route;
}

/**
 * Only the current account's own activity completes a step; club stock is not a personal shelf. The last two open the account page at
 * its picture and error-report parts (ONBOARD-1); error reports stay opt-in: the step is only a way there, the switch stays off until
 * the person turns it on.
 */
export function introSteps(
  stock: Pick<StockItem, 'quantityG' | 'clubId'>[],
  combinations: (Pick<Combination, 'own'> & { draft?: boolean })[],
  clubs: readonly unknown[],
  account: Pick<User, 'avatarId' | 'diagnosticsOptIn'>,
): IntroStep[] {
  return [
    {
      kind: 'shelf',
      complete: stock.some((item) => !item.clubId && item.quantityG > 0),
      route: { name: 'stock' },
    },
    {
      kind: 'combination',
      // Only a published combination of their own is recorded; a draft is still to do.
      complete: combinations.some((item) => item.own && !item.draft),
      route: { name: 'studio' },
    },
    { kind: 'club', complete: clubs.length > 0, route: { name: 'clubs' } },
    { kind: 'picture', complete: !!account.avatarId, route: { name: 'account', section: 'picture' } },
    { kind: 'diagnostics', complete: account.diagnosticsOptIn, route: { name: 'account', section: 'diagnostics' } },
  ];
}

/**
 * Whether the card has nothing left to offer. Error reports are optional: leaving them off is an answer too, so the card never stays
 * (or comes back) only to ask for them.
 */
export function introDone(steps: readonly IntroStep[]): boolean {
  return steps.every((step) => step.complete || step.kind === 'diagnostics');
}

const dismissalKey = (accountId: string) => 'glazelab:intro-dismissed:' + accountId;
type DeviceStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Optional, account-specific device preference; even access to localStorage can throw. */
export function readIntroDismissal(accountId: string, storage?: DeviceStorage): boolean {
  try {
    return (storage ?? globalThis.localStorage).getItem(dismissalKey(accountId)) === '1';
  } catch {
    return false;
  }
}

/** The caller hides the card in memory even when this optional write fails. */
export function rememberIntroDismissal(accountId: string, storage?: DeviceStorage): void {
  try {
    (storage ?? globalThis.localStorage).setItem(dismissalKey(accountId), '1');
  } catch {
    // The device may show the card again after this page's session.
  }
}

/** Sign-out and account deletion remove the account's flag from the device (27-7). */
export function forgetIntroDismissal(accountId: string, storage?: Pick<Storage, 'removeItem'>): void {
  try {
    (storage ?? globalThis.localStorage).removeItem(dismissalKey(accountId));
  } catch {
    // Nothing more can be done about unreadable storage.
  }
}
