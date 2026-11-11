import type { Readable } from 'svelte/store';
import { api } from '../../lib/api/client';
import { saveLastUser } from '../../lib/offline/offline';
import { isTokenRoute } from '../../lib/routing/routes';
import { createDiagnostics } from '../../lib/diagnostics/diagnostics';
import { collectDevice } from '../../lib/diagnostics/device';
import { installHooks } from '../../lib/diagnostics/hooks';
import type { AppState } from './app-state';
import type { AppContext } from './context';

/**
 * The error reports' wiring (32-2): the module, what it may do as the state changes (collect, send) and the device facts it reads.
 * Built at the controller's construction: its subscription runs at once and on every update.
 */
export function createDiagnosticsWiring(ctx: Pick<AppContext, 'read' | 'patch' | 'stale' | 'storage'>, state: Readable<AppState>) {
  /** A new app version waits (the update notice, told by App): one of the device facts of an error report. */
  let updatePending = false;
  /**
   * Error reports (32-2): collected and sent only while the signed-in account has opted in (`UserView.diagnosticsOptIn`); memory only,
   * never storage. The state below tells the module what it may do: collect (opted in), send (online, current terms, no token page).
   */
  const diagnostics = createDiagnostics({
    send: (batch) => api.sendReports(batch),
    device: () => {
      try {
        return collectDevice(updatePending, ctx.read().online);
      } catch {
        return {};
      }
    },
    route: () => (isTokenRoute(ctx.read().route) ? null : ctx.read().route.name),
    build: __APP_VERSION__,
    origin: globalThis.location?.origin,
    // 409: the choice is off on the server (another device turned it off): read the account again.
    onOff: () => {
      const actor = ctx.read().user?.id;
      void api
        .me()
        .then((user) => {
          if (actor && !ctx.stale(actor)) {
            ctx.patch({ user });
            return ctx.storage(() => saveLastUser(user));
          }
        })
        .catch(() => {});
    },
    onTermsRequired: () => ctx.patch({ termsRequired: true }),
  });
  state.subscribe((current) => {
    const enabled = !!current.user?.diagnosticsOptIn;
    if (enabled) installHooks(diagnostics);
    diagnostics.update({ enabled, canSend: current.online && !current.termsRequired && !isTokenRoute(current.route) });
  });

  return { diagnostics, setUpdatePending: (pending: boolean) => void (updatePending = pending) };
}
