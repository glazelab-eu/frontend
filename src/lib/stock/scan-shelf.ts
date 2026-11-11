/**
 * Earlier builds remembered the shelf a scan session last saved to (`glazelab:scan-shelf:<account ID>`, a club's ID), so
 * the next scan started on that club. Nothing reads or writes it any more (SHELF-3: a club shelf is only ever chosen on
 * purpose); sign-out and account deletion still remove a key such a build left on the device.
 */
export const scanShelfKey = (accountId: string) => 'glazelab:scan-shelf:' + accountId;

/** Sign-out and account deletion remove the account's old choice from the device. */
export function forgetScanShelf(accountId: string, storage?: Pick<Storage, 'removeItem'>): void {
  try {
    (storage ?? globalThis.localStorage).removeItem(scanShelfKey(accountId));
  } catch {
    // Nothing more can be done about unreadable storage.
  }
}
