import type { Diagnostics } from './diagnostics';

/** Console arguments as text: strings and error messages only; other values are named by type, never printed (they could hold anything). */
export function describeArgs(args: unknown[]): string {
  return args
    .map((arg) =>
      typeof arg === 'string' ? arg : arg instanceof Error ? `${arg.name}: ${arg.message}` : `[${typeof arg === 'object' ? 'object' : typeof arg}]`,
    )
    .join(' ');
}

function describeReason(reason: unknown): { message: string; stack?: string } {
  if (reason instanceof Error) return { message: `${reason.name}: ${reason.message}`, stack: reason.stack };
  return { message: typeof reason === 'string' ? reason : 'Unhandled rejection with a non-error value' };
}

let installed = false;
/** The diagnostics the hooks feed: the latest one given to `installHooks` (the app has one; tests create several). */
let sink: Diagnostics | null = null;

/**
 * Hooks the browser's error paths once: `error`, `unhandledrejection`, and `console.error`/`console.warn` (wrapped; the original always
 * runs first). The hooks only forward to `diagnostics.capture`, which discards everything while no account has opted in.
 */
export function installHooks(diagnostics: Diagnostics, target: Window & typeof globalThis = globalThis as Window & typeof globalThis): void {
  sink = diagnostics;
  if (installed) return;
  installed = true;
  target.addEventListener?.('error', (event) => {
    if (!(event instanceof ErrorEvent) || !event.message) return;
    const error = event.error instanceof Error ? event.error : undefined;
    sink?.capture('ERROR', error ? `${error.name}: ${error.message}` : event.message, error?.stack);
  });
  target.addEventListener?.('unhandledrejection', (event) => {
    const { message, stack } = describeReason(event.reason);
    sink?.capture('UNHANDLED_REJECTION', message, stack);
  });
  for (const [method, kind] of [
    ['error', 'ERROR'],
    ['warn', 'WARNING'],
  ] as const) {
    const original = target.console[method];
    target.console[method] = (...args: unknown[]) => {
      original.apply(target.console, args);
      try {
        const error = args.find((arg) => arg instanceof Error);
        sink?.capture(kind, describeArgs(args), error instanceof Error ? error.stack : undefined);
      } catch {
        /* Reporting never breaks the page. */
      }
    };
  }
}

/** Test seam: forget the one-time install. */
export function resetHooksForTest() {
  installed = false;
  sink = null;
}
