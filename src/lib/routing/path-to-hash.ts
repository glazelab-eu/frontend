/**
 * A typed or shared path such as `/clubs` or `/start` loads the app shell (Nginx and the service worker answer every
 * extensionless path with it), but the app routes by hash. The URL to show instead, or null when the address
 * already is a hash route (or the root). The aliases open the home route; an unknown name shows the in-app "not found".
 */
const homeAliases = new Set(['start', 'home', 'index', 'index.html']);

export function hashUrlForPath(pathname: string, search: string, hash: string): string | null {
  if (hash && hash !== '#') return null;
  const path = pathname.replace(/\/+$/, '');
  if (!path) return null;
  const name = path.slice(1);
  if (homeAliases.has(name.toLowerCase())) return `/#/${search}`;
  return `/#${path}${search}`;
}

/** Replaces the address in place (no history entry); runs before the app reads `location.hash`. */
export function redirectPathToHash(): void {
  const url = hashUrlForPath(location.pathname, location.search, location.hash);
  if (url) history.replaceState(history.state, '', url);
}
