import { routeHref, withoutPhotoPointer, type Route } from '../routing/routes';

export interface ShareData {
  title: string;
  url: string;
}

/** What the system share sheet takes: a link with its title, or a message that already holds its link. */
export type ShareContent = { title: string; url: string } | { text: string };

/** The parts of `navigator` that sharing uses; the real object is passed whole so `share` keeps its `this`. */
export interface ShareEnv {
  share?: (data: ShareContent) => Promise<void>;
  clipboard?: { writeText: (text: string) => Promise<void> };
}

/**
 * What happened: the system share sheet took the link (`shared`), the user closed it (`cancelled`, silent),
 * the link was copied (`copied`) or neither worked and the user has to copy it by hand (`manual`).
 */
export type ShareOutcome = 'shared' | 'cancelled' | 'copied' | 'manual';

/**
 * The absolute link to a page: site origin, base path and the route's own hash, never the current
 * `location.href`, which may carry list state, search filters or a token route.
 */
export function canonicalUrl(route: Route, site: { origin: string; pathname: string }): string {
  return site.origin + site.pathname + routeHref(withoutPhotoPointer(route));
}

const cancelled = (cause: unknown) => cause instanceof Error && cause.name === 'AbortError';

/** Copies a link to the clipboard; false when there is no clipboard or the browser refused, so the user copies it by hand. */
export async function copyLink(text: string, env: Pick<ShareEnv, 'clipboard'>): Promise<boolean> {
  try {
    if (typeof env.clipboard?.writeText !== 'function') return false;
    await env.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

async function shareOrCopy(data: ShareContent, copyable: string, env: ShareEnv): Promise<ShareOutcome> {
  if (typeof env.share === 'function') {
    try {
      await env.share(data);
      return 'shared';
    } catch (cause) {
      if (cancelled(cause)) return 'cancelled';
    }
  }
  return (await copyLink(copyable, env)) ? 'copied' : 'manual';
}

/**
 * Shares through the system sheet when there is one, else copies the link, else asks for a manual copy. Call it
 * from a click handler: `share` needs the click, and Safari may refuse the clipboard write that follows an
 * awaited failed share, which then falls through to `manual`.
 */
export const shareLink = (data: ShareData, env: ShareEnv): Promise<ShareOutcome> => shareOrCopy(data, data.url, env);

/** `shareLink` for a message (27-3: "Hi Ada, could I borrow …"): the sheet gets the text, which holds its own link; the fallback copies the text. */
export const shareMessage = (text: string, env: ShareEnv): Promise<ShareOutcome> => shareOrCopy({ text }, text, env);
