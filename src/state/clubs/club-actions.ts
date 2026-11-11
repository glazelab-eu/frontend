import { api } from '../../lib/api/client';
import type { ClubMember, InvitePreview } from '../../lib/api/models';
import type { ClubSettingsInput } from '../../lib/api/inputs';
import { isLinkToken } from '../../lib/buddies/buddies';
import { dropCachedImages } from '../../lib/offline/offline';
import { canonicalUrl } from '../../lib/share/share';
import { clubForm, shownImageUrls, withoutClub } from '../app/app-state';
import type { AppContext } from '../app/context';
import type { KnownInvite } from './club-invite.svelte';

/**
 * Clubs: creating, settings, roles, leaving, removing members, the invite link and joining by one. Owns this session's invite tokens
 * (dropped on an account change through `onAccountChange`) and the one-create-at-a-time flag.
 */
export function createClubActions(
  ctx: Pick<AppContext, 'read' | 'patch' | 'stale' | 'query' | 'mutate' | 'mutateFor' | 'load' | 'saveCurrent' | 'go' | 'visit' | 'onAccountChange'>,
) {
  /**
   * The invite links generated in this session, by club ID, each with the `inviteVersion` the API answered with it
   * (the club reports the version of its active link, so a load tells a link another admin replaced from this one).
   * The API answers a token only once, so the club page shows it again from here until a reload. Memory only (never
   * the store, a snapshot, storage or history), dropped on an account change and on leaving the club; the display
   * decides by the version (`inviteKind`), so a load that read the club before or after the generation can never
   * lose or mislead it.
   */
  const inviteTokens = new Map<string, { token: string; version: string }>();
  ctx.onAccountChange(() => inviteTokens.clear());
  let creatingClub = false;

  /** Creates a club, reloads and opens its page; answers the new club's ID, or null after a failure. */
  function createClub(name: string): Promise<string | null> {
    // One create at a time, whatever page instance asks: a form reopened mid-request must not make a second club.
    if (creatingClub) return Promise.resolve(null);
    creatingClub = true;
    const startedAt = ctx.visit();
    return ctx
      .mutateFor({
        request: async () => {
          const { id } = await api.createClub(name);
          await ctx.load();
          return id;
        },
        // The page opens only while the writer is still on the visit that started the request.
        apply: async (id) => {
          if (ctx.visit() === startedAt) ctx.go({ name: 'club', id });
          return id;
        },
        notice: 'notices.clubCreated',
        // The form is gone once the writer left the page: a failure then shows in the banner.
        form: () => (ctx.visit() === startedAt ? 'club' : undefined),
      })
      .finally(() => {
        creatingClub = false;
      });
  }

  /**
   * Saves a club's name, rules and invite switch, then reloads the memberships. A 404 is a club this account no longer
   * sees (removed meanwhile; the API answers it like an unknown club): the reload takes it off the listings, so its page
   * says "not found". The same holds for the role change and the invite link.
   */
  function updateClub(id: string, settings: ClubSettingsInput) {
    return ctx.mutate({
      request: () => api.updateClub(id, settings),
      apply: () => ctx.load(),
      reloadOn: [404],
      form: clubForm('settings', id),
    });
  }

  /** Changes a member's role and reloads the clubs with their members (the account may have demoted itself). */
  function changeClubRole(id: string, memberId: string, role: ClubMember['role']) {
    return ctx.mutate({
      request: () => api.changeClubRole(id, memberId, { role }),
      apply: () => ctx.load(),
      // A stale list (someone else changed the admins meanwhile, the member left, or the account is no longer in the
      // club: 404) is refreshed before the refusal shows.
      reloadOn: [404, 409],
      form: clubForm('members', id),
    });
  }

  /**
   * Leaves a club. What only its members may see (the club, its members, its shelf, its club photos) leaves the
   * listings, the snapshot and the picture cache at once, its invite link the memory, before everything reloads, so a
   * failed reload keeps nothing of it. A refusal (the last admin, or no member any more) reloads before it shows.
   */
  function leaveClub(id: string) {
    return ctx.mutate({
      request: (actor) => api.removeClubMember(id, actor as string),
      apply: async (_, actor) => {
        const left = withoutClub(ctx.read(), id);
        const kept = new Set(shownImageUrls(left));
        const gone = shownImageUrls(ctx.read()).filter((url) => !kept.has(url));
        inviteTokens.delete(id);
        ctx.patch(left);
        await dropCachedImages(actor, gone);
        await ctx.saveCurrent(actor);
        if (ctx.stale(actor)) return false;
        await ctx.load();
      },
      notice: 'notices.clubLeft',
      requireOnline: true,
      reloadOn: [403, 409],
      form: clubForm('leave', id),
    });
  }

  /** A club admin removes another member, then the clubs reload with their members and shelves. */
  function removeClubMember(id: string, memberId: string) {
    return ctx.mutate({
      request: () => api.removeClubMember(id, memberId),
      apply: () => ctx.load(),
      notice: 'notices.memberRemoved',
      requireOnline: true,
      // Someone else changed the club meanwhile (roles, the member left): the list is refreshed before the refusal shows.
      reloadOn: [403, 404, 409],
      form: clubForm('members', id),
    });
  }

  /**
   * Replaces a club's invite link and answers the new link, or null after a failure. The token and its version are
   * remembered at once, from the answer, together with what the server did to the club (a link, invites on, the new
   * version), in one update: the page never sees the new token beside the old club (which would call it replaced), and
   * a load that raced the generation cannot hide it, since the display decides by the version.
   */
  function regenerateInvite(id: string): Promise<string | null> {
    return ctx.mutateFor({
      request: () => api.regenerateInvite(id),
      apply: async ({ token, version }) => {
        inviteTokens.set(id, { token, version });
        ctx.patch({
          clubs: ctx.read().clubs.map((club) => (club.id === id ? { ...club, hasInviteLink: true, invitesEnabled: true, inviteVersion: version } : club)),
        });
        await ctx.load();
        // A club that left the listings meanwhile has no page to show the link in.
        return ctx.read().clubs.some((club) => club.id === id) ? (inviteLink(id)?.link ?? null) : null;
      },
      // A club this account no longer sees (see `updateClub`).
      reloadOn: [404],
      form: clubForm('invite', id),
    });
  }

  /** The club's invite link generated in this session, or null (none yet, the page was reloaded, or the club lost it). */
  function inviteLink(id: string): KnownInvite | null {
    const known = inviteTokens.get(id);
    return known ? { link: canonicalUrl({ name: 'invite', token: known.token }, location), version: known.version } : null;
  }

  /** What an invite link offers (the club's name and rules); nothing is joined. Null after a failure. */
  function previewInvite(token: string): Promise<InvitePreview | null> {
    if (!isLinkToken(token)) {
      ctx.patch({ formError: { form: 'invite', message: 'errors.inviteInvalid' } });
      return Promise.resolve(null);
    }
    return ctx.query(() => api.previewInvite(token), 'invite');
  }

  /** Joins the club of an invite link; the route is replaced by the club's page so the token leaves the history. */
  function joinClub(token: string) {
    if (!isLinkToken(token)) {
      ctx.patch({ formError: { form: 'invite', message: 'errors.inviteInvalid' } });
      return Promise.resolve(false);
    }
    return ctx.mutate({
      request: () => api.joinClub(token),
      apply: async ({ id }) => {
        ctx.go({ name: 'club', id }, { replace: true });
        await ctx.load();
      },
      form: 'invite',
    });
  }

  return { createClub, updateClub, changeClubRole, leaveClub, removeClubMember, regenerateInvite, inviteLink, previewInvite, joinClub };
}
