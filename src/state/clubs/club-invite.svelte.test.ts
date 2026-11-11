import { describe, expect, it, vi } from 'vitest';
import { createClubInvite, inviteKind, type InviteState, type KnownInvite } from './club-invite.svelte';

const link = (token: string) => `https://glazelab.eu/#/invite/${token}`;

const loaded = (changes: Partial<InviteState> = {}): InviteState => ({
  role: 'ADMIN',
  hasInviteLink: true,
  invitesEnabled: true,
  inviteVersion: 'v0',
  ...changes,
});

function setup({ current = null as string | null, hasLink = false, copied = true, enabled = true } = {}) {
  let next = 1;
  let club = loaded({ hasInviteLink: hasLink || current !== null, invitesEnabled: enabled });
  let known: KnownInvite | null = current ? { link: current, version: 'v0' } : null;
  const regenerate = vi.fn(async (): Promise<string | null> => {
    const created = link(`t${next++}`);
    // Generating turns invite links on and gives the club a new version: the reload reports both.
    club = loaded({ inviteVersion: `v${next}` });
    known = { link: created, version: `v${next}` };
    return created;
  });
  const copy = vi.fn(async () => copied);
  const invite = createClubInvite({ regenerate, current: () => known, copy }, () => club);
  return {
    invite,
    regenerate,
    copy,
    /** The club as a later load reports it (a new object, as every load makes). */
    reload: (changes: Partial<InviteState> = {}) => (club = { ...club, ...changes }),
  };
}

describe('inviteKind', () => {
  const known = { link: link('a'), version: 'v0' };

  it('shows the link of this session while it is the active one and invites are on, however often the club was loaded', () => {
    expect(inviteKind(known, loaded())).toBe('shown');
    expect(inviteKind(known, loaded())).toBe('shown');
  });

  it('says another admin replaced the link as soon as the club reports another version, also after an own save', () => {
    expect(inviteKind(known, loaded({ inviteVersion: 'v1' }))).toBe('replaced');
    expect(inviteKind(known, loaded({ inviteVersion: 'v1', invitesEnabled: false }))).toBe('replaced');
  });

  it('keeps the link of this session for when invites are turned back on', () => {
    expect(inviteKind(known, loaded({ invitesEnabled: false }))).toBe('off');
    expect(inviteKind(known, loaded({ invitesEnabled: true }))).toBe('shown');
  });

  it('knows a link of the club only by its existence without one of this session', () => {
    expect(inviteKind(null, loaded())).toBe('hidden');
    expect(inviteKind(null, loaded({ invitesEnabled: false }))).toBe('hidden');
    expect(inviteKind(null, loaded({ hasInviteLink: false, inviteVersion: null }))).toBe('none');
    expect(inviteKind(known, loaded({ hasInviteLink: false, inviteVersion: null }))).toBe('none');
  });

  it('says nothing about a link to a plain member, who gets no version from the API', () => {
    expect(inviteKind(null, loaded({ role: 'MEMBER', inviteVersion: null }))).toBe('none');
    // Demoted after generating a link in this session: not called replaced.
    expect(inviteKind(known, loaded({ role: 'MEMBER', inviteVersion: null }))).toBe('none');
    // An older snapshot saved the version for a member too: it decides nothing.
    expect(inviteKind(known, loaded({ role: 'MEMBER' }))).toBe('none');
    expect(inviteKind(known, loaded({ role: 'MEMBER', invitesEnabled: false }))).toBe('none');
  });
});

describe('createClubInvite', () => {
  it('generates the first link at once and keeps it shown', async () => {
    const { invite, regenerate } = setup();
    expect(invite.link).toBeNull();
    await invite.request();
    expect(regenerate).toHaveBeenCalledTimes(1);
    expect(invite).toMatchObject({ link: link('t1'), kind: 'shown', confirming: false });
  });

  it('a new club with invites off: the first link shows at once, and the hint says that generating turns invites on', async () => {
    const { invite, regenerate } = setup({ enabled: false });
    expect(invite).toMatchObject({ link: null, turnsInvitesOn: true });
    await invite.request();
    expect(regenerate).toHaveBeenCalledTimes(1);
    expect(invite).toMatchObject({ link: link('t1'), kind: 'shown', confirming: false, turnsInvitesOn: false });
  });

  it('after turning invites off, the link is hidden but comes back with them; generating again asks first and shows the new link', async () => {
    const { invite, regenerate, reload } = setup({ current: link('kept'), hasLink: true });
    reload({ invitesEnabled: false });
    expect(invite).toMatchObject({ link: null, kind: 'off', turnsInvitesOn: true });
    reload({ invitesEnabled: true });
    expect(invite).toMatchObject({ link: link('kept'), kind: 'shown' });
    reload({ invitesEnabled: false });
    await invite.request();
    expect(invite.confirming).toBe(true);
    await invite.confirm();
    expect(regenerate).toHaveBeenCalledTimes(1);
    expect(invite).toMatchObject({ link: link('t1'), kind: 'shown', turnsInvitesOn: false });
  });

  it('shows the link generated earlier in the session again (panel reopened, page entered again)', () => {
    const { invite, regenerate } = setup({ current: link('kept'), hasLink: true });
    expect(invite.link).toBe(link('kept'));
    expect(regenerate).not.toHaveBeenCalled();
  });

  it('follows the club: a load that reports another version drops the link, the same version keeps it', () => {
    const { invite, reload } = setup({ current: link('kept'), hasLink: true });
    reload();
    expect(invite).toMatchObject({ link: link('kept'), kind: 'shown' });
    reload({ inviteVersion: 'other' });
    expect(invite).toMatchObject({ link: null, kind: 'replaced' });
    reload({ hasInviteLink: false, inviteVersion: null });
    expect(invite).toMatchObject({ link: null, kind: 'none' });
  });

  it('shows a link generated after a drop', async () => {
    const { invite, reload } = setup({ current: link('kept'), hasLink: true });
    reload({ hasInviteLink: false, inviteVersion: null });
    await invite.request();
    expect(invite.confirming).toBe(false);
    reload({ hasInviteLink: true });
    await invite.request();
    await invite.confirm();
    expect(invite).toMatchObject({ link: link('t2'), kind: 'shown' });
  });

  it('asks before replacing an existing link; Cancel sends no request and keeps the link', async () => {
    const { invite, regenerate } = setup({ current: link('kept'), hasLink: true });
    await invite.request();
    expect(invite.confirming).toBe(true);
    expect(regenerate).not.toHaveBeenCalled();
    invite.cancel();
    expect(invite).toMatchObject({ confirming: false, link: link('kept') });
    await invite.confirm();
    expect(regenerate).not.toHaveBeenCalled();
  });

  it('asks before replacing a link of this session', async () => {
    const { invite, regenerate } = setup();
    await invite.request();
    await invite.request();
    expect(invite.confirming).toBe(true);
    expect(regenerate).toHaveBeenCalledTimes(1);
  });

  it('replaces the link after confirming, once', async () => {
    const { invite, regenerate } = setup({ hasLink: true });
    await invite.request();
    await Promise.all([invite.confirm(), invite.confirm()]);
    expect(regenerate).toHaveBeenCalledTimes(1);
    expect(invite).toMatchObject({ confirming: false, link: link('t1') });
  });

  it('keeps the shown link when the replacement fails', async () => {
    const { invite, regenerate } = setup({ current: link('kept'), hasLink: true });
    regenerate.mockResolvedValueOnce(null);
    await invite.request();
    await invite.confirm();
    expect(invite.link).toBe(link('kept'));
  });

  it('copies the shown link and reports a refused copy for the manual fallback', async () => {
    const copied = setup({ current: link('kept') });
    await copied.invite.copy();
    expect(copied.copy).toHaveBeenCalledWith(link('kept'));
    expect(copied.invite.copyRefused).toBe(false);
    const refused = setup({ current: link('kept'), copied: false });
    await refused.invite.copy();
    expect(refused.invite.copyRefused).toBe(true);
  });

  it('copies nothing without a link', async () => {
    const { invite, copy } = setup();
    await invite.copy();
    expect(copy).not.toHaveBeenCalled();
  });
});
