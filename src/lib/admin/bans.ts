import type { Ban, User } from '../api/models';

/** Longest ban reason the API accepts (`BanInput.reason`), counted like `maxlength`. */
export const MAX_BAN_REASON = 500;

/** A ban reason as the API takes it: trimmed, required (null when blank). */
export const banReason = (text: string): string | null => text.trim() || null;

/**
 * Whether the ban control is offered: a site admin, for an account that is known (a report or row of a deleted account has no ID)
 * and is not their own. A site admin among the members is still offered (the API refuses it with its own message): the client
 * cannot tell which members are site admins.
 */
export function canBan(viewer: Pick<User, 'id' | 'siteAdmin'> | null | undefined, targetId: string | null | undefined): targetId is string {
  return !!viewer?.siteAdmin && !!targetId && targetId !== viewer.id;
}

export const banIdOf = (ban: Pick<Ban, 'id'>) => ban.id;

/** The list after a ban was lifted: only that entry leaves. */
export const withoutBan = <T extends Pick<Ban, 'id'>>(bans: T[], id: string): T[] => bans.filter((ban) => ban.id !== id);
