import type { MessageKey } from '../../lib/i18n';
import type { FormName } from './app-state';

/** One write: the API call, what follows it, and the lifecycle around both (see `write`). */
export interface Write<R, T> {
  /**
   * The API call, and anything that must follow it even if the account changed meanwhile.
   * Answering `false` ends the write quietly, so a result that can legitimately be `false` must
   * be wrapped.
   */
  request: (actor: string | undefined) => Promise<R | false>;
  /**
   * Runs after the request unless the account changed meanwhile (then the write ends quietly):
   * patches the listings, reloads, navigates. Its value is what `mutateFor` answers.
   */
  apply?: (result: R, actor: string | undefined) => Promise<T | null | void | false>;
  /** Shown after a successful write; a function is asked after `apply`, so it can depend on what `apply` found. */
  notice?: MessageKey | (() => MessageKey);
  /**
   * The write belongs to a form: its failure shows there (`formError`), not in the banner. A function
   * is asked at the start and again on failure, so a write that outlives its page can report in the banner.
   */
  form?: FormName | (() => FormName | undefined);
  /** Needs a signed-in account and a reachable API; otherwise it answers false without a trace. */
  requireOnline?: boolean;
  /** Statuses after which the listings are reloaded, before the failure is reported. */
  reloadOn?: number[];
  /** One write per key at a time (e.g. `deleting:<id>`); a second one answers false. */
  busy?: string;
}
