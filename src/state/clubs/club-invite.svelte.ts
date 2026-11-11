import type { Club } from '../../lib/api/models';

/** What the club's load says about its invite link (the API reports `inviteVersion` to admins only, null to plain members). */
export type InviteState = Pick<Club, 'role' | 'hasInviteLink' | 'invitesEnabled' | 'inviteVersion'>;

/** An invite link generated in this session, with the `inviteVersion` the API answered with it. */
export interface KnownInvite {
  link: string;
  version: string;
}

/**
 * What the invite panel can say about the club's link: `none` (the club has no link), `shown` (this session's link is
 * the active one and invites are on), `off` (it is the active one but invites are disabled, so it is hidden until they
 * are turned on), `replaced` (a newer link was generated elsewhere: another admin, or this account on another device; this session's no longer works) and `hidden`
 * (the club has a link this session never saw: the API answers a token only when it is generated). For a plain member
 * it is always `none`: the invite panel is the admins', and the API gives members no version to compare (a link this
 * session generated before a demotion, or an older snapshot's version, tells them nothing).
 */
export type InviteKind = 'none' | 'shown' | 'off' | 'replaced' | 'hidden';

/** What to show of a link generated in this session, decided by the club's `inviteVersion` alone (no load order matters). */
export function inviteKind(known: KnownInvite | null, club: InviteState): InviteKind {
  if (club.role !== 'ADMIN' || !club.hasInviteLink) return 'none';
  if (!known) return 'hidden';
  if (club.inviteVersion !== known.version) return 'replaced';
  return club.invitesEnabled ? 'shown' : 'off';
}

/** What a club's invite section asks the app to do. */
export interface ClubInviteActions {
  /** Replaces the club's link; answers the new link, or null after a failure (shown at the section's form). */
  regenerate: () => Promise<string | null>;
  /** The link generated in this session (kept in the controller's memory), or null. */
  current: () => KnownInvite | null;
  /** Copies with the "Link copied" notice; false when the browser refused. */
  copy: (link: string) => Promise<boolean>;
}

/**
 * A club's invite panel: the link generated in this session stays shown, also after the panel was closed or the page
 * left (the API answers a token only once, so after a reload the club only says it has a link) while it is the club's
 * active link and invites are on (`inviteKind`). Replacing an existing link asks first, because the old one stops
 * working; a refused copy leaves the selectable field.
 */
export function createClubInvite(actions: ClubInviteActions, club: () => InviteState) {
  // Counts generated links, so what `known` reads from the app's memory is read again after one.
  let generated = $state(0);
  let confirming = $state(false);
  let copyRefused = $state(false);
  const known = () => {
    void generated;
    return actions.current();
  };
  const kind = () => inviteKind(known(), club());
  const link = () => (kind() === 'shown' ? (known()?.link ?? null) : null);

  async function generate() {
    copyRefused = false;
    if (await actions.regenerate()) generated++;
  }

  return {
    /** What the panel says about the club's link. */
    get kind() {
      return kind();
    },
    /** The link to show, or null. */
    get link() {
      return link();
    },
    /** Invite links are off, so generating one turns them on (the API does; the settings switch turns them off). */
    get turnsInvitesOn() {
      return !club().invitesEnabled;
    },
    /** The replace question is open. */
    get confirming() {
      return confirming;
    },
    get copyRefused() {
      return copyRefused;
    },
    /** Creates the first link at once; with a link in place it only opens the question. */
    async request() {
      if (club().hasInviteLink) confirming = true;
      else await generate();
    },
    cancel() {
      confirming = false;
    },
    async confirm() {
      if (!confirming) return;
      confirming = false;
      await generate();
    },
    async copy() {
      const shown = link();
      if (shown) copyRefused = !(await actions.copy(shown));
    },
  };
}
