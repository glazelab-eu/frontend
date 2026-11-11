import { isLinkToken } from '../buddies/buddies';

/** The two routes a scanned code may open, and what each is for. */
export type ScanKind = 'buddy' | 'invite';
export interface ScannedLink {
  name: ScanKind;
  token: string;
}

/**
 * The route of a scanned QR text, or null when it is anything else. Only a link of this app (its own origin, no
 * search part, no credentials; the pathname is ignored, since a link made on a device that opened the app at
 * `/index.html` must work on one at `/`, and only the `#/` route is ever opened) to `#/buddy/<token>` or `#/invite/<token>` with a token of the API's shape
 * counts, and only the kinds in `allowed`: the text is untrusted camera input and never opened otherwise. The
 * result holds the token in memory only; the caller opens the route and the existing token-link rules take over.
 */
export function scannedLink(text: string, site: { origin: string }, allowed: readonly ScanKind[]): ScannedLink | null {
  if (!text || /\s/.test(text)) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.origin !== site.origin || url.origin === 'null') return null;
  if (url.username || url.password || url.search) return null;
  const match = /^#\/(buddy|invite)\/([^/?#]*)$/.exec(url.hash);
  if (!match) return null;
  const name = match[1] as ScanKind;
  return allowed.includes(name) && isLinkToken(match[2]) ? { name, token: match[2] } : null;
}
