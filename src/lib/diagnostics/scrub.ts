/**
 * The client's scrubbing of an error report (32-2). The server scrubs again (`ReportScrubber`), so this is the first line of defence:
 * what must never leave the device is removed before an event is even buffered.
 */

export const MESSAGE_MAX = 1000;
export const STACK_MAX = 3000;
/** The server refuses an event whose JSON is larger. */
export const EVENT_BYTES_MAX = 4096;

const SECRET_NAME = '(?:[\\w.-]*(?:token|password|passwd|secret|session|csrf|xsrf|authorization|cookie|api[ _-]?key)[\\w.-]*)';
const BEARER = /\bBearer\s+[^\s"',;]+/gi;
/** A quoted value of a secret-named pair, in JSON (`"token": "x"`) or JavaScript (`token: 'x y'`, `token="x y"`) notation. */
const QUOTED_PAIR = new RegExp(`(\\b${SECRET_NAME}["']?\\s*[=:]\\s*)(["'])(?:(?!\\2)[^\\\\]|\\\\.)*\\2`, 'gi');
const PAIR = new RegExp(`(\\b${SECRET_NAME}\\s*[=:]\\s*)[^\\s"',;&]+`, 'gi');
const EMAIL = /[\p{L}\p{N}._%+'-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;
/** A query string ends at whitespace, a closing bracket or the `:line:column` of a stack frame. */
const QUERY = /\?[^\s"'<>)\]]*?(?=(?::\d+){1,2}(?!\w)|[\s"'<>)\]]|$)/g;
const FRAGMENT = /#[^\s"'<>)\]]*/g;
const LONG_TOKEN = /[A-Za-z0-9_-]{32,}/g;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;

/** Cuts to `max` code points, never inside a surrogate pair. */
export function truncate(text: string, max: number): string {
  const points = Array.from(text);
  return points.length <= max ? text : points.slice(0, max).join('');
}

/** Removes control characters and unpaired surrogates. */
function clean(text: string): string {
  return text.replace(CONTROL, '').replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '');
}

/**
 * Text without anything that could identify a person or open a door: bearer tokens, values of secret-named pairs, email addresses,
 * query strings, fragments (the hash routes carry the single-use tokens) and long token-like runs (a UUID is an ordinary ID and stays).
 */
export function scrubText(text: string, max: number): string {
  const scrubbed = clean(text)
    .replace(QUERY, '')
    .replace(FRAGMENT, '')
    .replace(BEARER, 'Bearer [redacted]')
    .replace(QUOTED_PAIR, '$1$2[redacted]$2')
    .replace(PAIR, '$1[redacted]')
    .replace(EMAIL, '[email]')
    .replace(LONG_TOKEN, (run) => (UUID.test(run) ? run : '[token]'));
  return truncate(scrubbed, max);
}

/** A stack without the app's origin (same on every device) and scrubbed like a message. */
export function scrubStack(stack: string, origin = ''): string {
  return scrubText(origin ? stack.split(origin).join('') : stack, STACK_MAX);
}

/** The key that tells a repeat from a new event: the kind and the message with every digit run as 0 (the server's fingerprint, minus the hash). */
export function eventKey(kind: string, message: string): string {
  return `${kind}\n${message.replace(/\d+/g, '0')}`;
}

/** The size the server measures: the event as JSON, in UTF-8 bytes. */
export function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}
