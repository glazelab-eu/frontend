/**
 * The one load counter of the app controller (STATE-1a): every load takes a version (`begin`) and checks it after each await
 * (`isCurrent`), so a newer load, a sign-out, an account deletion or a stopped controller (`cancel`) discards whatever an older
 * load still brings. `now` is the version reached so far (the `offline` event records it). One ticket per controller, shared by
 * every module: never a counter of a module's own.
 */
export interface LoadTicket {
  /** Starts a load whose result is kept: answers its version, which every older version is no longer. */
  begin: () => number;
  /** Discards every load under way without starting one. */
  cancel: () => void;
  /** `version` is still the newest: no later load began and nothing cancelled it. */
  isCurrent: (version: number) => boolean;
  /** The newest version so far. */
  now: () => number;
}

export function createLoadTicket(): LoadTicket {
  let loadVersion = 0;
  return {
    begin: () => ++loadVersion,
    cancel: () => {
      ++loadVersion;
    },
    isCurrent: (version) => version === loadVersion,
    now: () => loadVersion,
  };
}
