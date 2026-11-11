import type { Buddy } from '../../lib/api/models';

/** What the Buddies section asks the app to do (the controller's buddy actions); the row actions answer whether they worked. */
export interface BuddyActions {
  accept: (buddy: Buddy) => Promise<boolean>;
  decline: (buddy: Buddy) => Promise<boolean>;
  cancel: (buddy: Buddy) => Promise<boolean>;
  remove: (buddy: Buddy) => Promise<boolean>;
  /**
   * Creates (`replace` false: the page shows no link) or replaces (after the question) the buddy link; answers the new link,
   * or null after a failure or when a create finds a link made elsewhere meanwhile (the page then offers Replace).
   */
  createLink: (replace: boolean) => Promise<string | null>;
  /** The link generated in this session, or null. */
  currentLink: () => string | null;
  /** Copies a link with a notice; false when the browser refused. */
  copyLink: (link: string) => Promise<boolean>;
  /** Opens the device's share sheet for a link, else copies it; answers the link only when the user must copy it by hand. */
  shareLink: (title: string, url: string) => Promise<string | null>;
}

/** What the phone account menu's "Show my buddy code" needs: whether the account has a link, the connection, the last link error and the link actions. */
export interface BuddyCode {
  hasLink: boolean;
  online: boolean;
  error: string;
  actions: Pick<BuddyActions, 'createLink' | 'currentLink' | 'copyLink' | 'shareLink'>;
}
