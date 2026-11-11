import type { ClubMember } from '../../lib/api/models';
import type { ClubSettingsInput } from '../../lib/api/inputs';
import type { KnownInvite } from '../../state/clubs/club-invite.svelte';

/** What the club page's settings and invite panel ask the app to do (the controller's club actions). */
export interface ClubActions {
  updateClub: (id: string, settings: ClubSettingsInput) => Promise<boolean>;
  /** Answers whether it worked; the app then reloads the clubs with their members. */
  changeClubRole: (id: string, memberId: string, role: ClubMember['role']) => Promise<boolean>;
  /** A club admin removes another member; answers whether it worked (the app then reloads the clubs). */
  removeClubMember: (id: string, memberId: string) => Promise<boolean>;
  /** Replaces the invite link; answers the new link, or null after a failure. */
  regenerateInvite: (id: string) => Promise<string | null>;
  /** The invite link generated in this session, or null. */
  inviteLink: (id: string) => KnownInvite | null;
  /** Copies a link with a notice; false when the browser refused. */
  copyLink: (link: string) => Promise<boolean>;
  /** Opens the device's share sheet for a link, else copies it; answers the link only when the user must copy it by hand. */
  shareLink: (title: string, url: string) => Promise<string | null>;
}
