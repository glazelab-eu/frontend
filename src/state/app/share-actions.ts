import { canonicalUrl, copyLink, shareLink, shareMessage } from '../../lib/share/share';
import type { Route } from '../../lib/routing/routes';
import type { AppContext } from './context';

/** Sharing and copying links and messages: the system share sheet, else a copy with a notice. */
export function createShareActions(ctx: Pick<AppContext, 'notify'>) {
  /**
   * Shares the page of a glaze or combination (its canonical link, never the current address): the system sheet,
   * else a copy with a notice. Answers the link only when the user has to copy it by hand. Call it from a click handler.
   */
  function share(title: string, route: Route): Promise<string | null> {
    return shareUrl(title, canonicalUrl(route, location));
  }

  /** `share` for a link that is not a page's canonical one (a club's invite link). */
  async function shareUrl(title: string, url: string): Promise<string | null> {
    const outcome = await shareLink({ title, url }, navigator);
    if (outcome === 'copied') ctx.notify('notices.linkCopied');
    return outcome === 'manual' ? url : null;
  }

  /**
   * Shares the message of an "Ask Ada" (it holds its own link): the system sheet where there is one, else a copy with the
   * notice "Message copied". Answers the text only when the user has to copy it by hand.
   */
  async function shareMessageText(text: string): Promise<string | null> {
    const outcome = await shareMessage(text, navigator);
    if (outcome === 'copied') ctx.notify('notices.messageCopied');
    return outcome === 'manual' ? text : null;
  }

  /** Copies a link with the notice "Link copied"; false when the browser refused, so the caller offers a manual copy. */
  async function copy(url: string): Promise<boolean> {
    const copied = await copyLink(url, navigator);
    if (copied) ctx.notify('notices.linkCopied');
    return copied;
  }

  return { share, shareUrl, shareMessage: shareMessageText, copyLink: copy };
}
