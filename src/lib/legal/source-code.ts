/**
 * The AGPL source offer (section 13) in the footer: the server's `sourceUrl` (`GLAZELAB_SOURCE_URL`, from the public sign-in
 * options) and the third-party notices the build writes (`scripts/third-party-licenses.ts`).
 */

/** The notices file at the root of the build output. */
export const THIRD_PARTY_HREF = '/THIRD-PARTY-LICENSES.txt';

/** The link target for a configured source URL, or null: unset, not yet known, or anything but an absolute http(s) URL. */
export function sourceHref(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}
