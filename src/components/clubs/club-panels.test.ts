import { beforeAll, describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { setLocale, translate } from '../../lib/i18n';
import { club, clubMember } from '../../test/fixtures';
import ClubInvitePanel from './ClubInvitePanel.svelte';
import ClubSettings from './ClubSettings.svelte';
import type { ClubActions } from './club-actions';

const actions: ClubActions = {
  updateClub: async () => true,
  changeClubRole: async () => true,
  removeClubMember: async () => true,
  regenerateInvite: async () => null,
  inviteLink: () => null,
  copyLink: async () => true,
  shareLink: async () => null,
};

/** The server-rendered invite panel of club c1 with the given invite state. */
const panel = (invitesEnabled: boolean, hasInviteLink = false) =>
  render(ClubInvitePanel, {
    props: { club: club({ role: 'ADMIN', invitesEnabled, hasInviteLink }), online: true, actions, formError: null },
  }).body;

/** The server-rendered settings of club c1 with the given member list. */
const settings = (members: ReturnType<typeof clubMember>[] | undefined, invitesEnabled = true) =>
  render(ClubSettings, {
    props: { club: club({ role: 'ADMIN', invitesEnabled }), members, userId: 'u1', online: true, actions, formError: null },
  }).body;

beforeAll(() => setLocale('en'));

describe('ClubInvitePanel invite switch and hint', () => {
  const hint = () => translate('clubs.settings.invites.turnsOn');

  it('while invites are off, says under the button that generating a link turns them on, and the button is described by it', async () => {
    const body = panel(false);
    const id = /<p id="([^"]+-turns-on)">([^<]*)<\/p>/.exec(body);
    expect(id?.[2].trim()).toBe(hint());
    expect(body).toMatch(new RegExp(`<button[^>]*aria-describedby="${id?.[1]}"[^>]*>\\s*${translate('clubs.settings.invites.generate')}`));
  });

  it('while invites are on, shows no such hint', async () => {
    for (const hasLink of [false, true]) {
      const body = panel(true, hasLink);
      expect(body).not.toContain(hint());
      expect(body).not.toContain('-turns-on');
    }
  });

  it('calls a remembered link of an older version replaced without blaming another admin (it may be this account on another device)', async () => {
    const remembered: ClubActions = { ...actions, inviteLink: () => ({ link: 'https://glazelab.eu/#/invite/old', version: 'v1' }) };
    const body = render(ClubInvitePanel, {
      props: {
        club: club({ role: 'ADMIN', invitesEnabled: true, hasInviteLink: true, inviteVersion: 'v2' }),
        online: true,
        actions: remembered,
        formError: null,
      },
    }).body;
    expect(body).toContain(translate('clubs.settings.invites.replaced'));
    expect(body).not.toContain('#/invite/old');
    for (const locale of ['en', 'de', 'pt-PT', 'it', 'es']) {
      await setLocale(locale);
      expect(translate('clubs.settings.invites.replaced')).toMatch(/device|Gerät|dispositivo/);
    }
    await setLocale('en');
  });

  it('says a link of the club that this session never saw cannot be shown, and offers to replace it', async () => {
    const body = panel(true, true);
    expect(body).toContain(translate('clubs.settings.invites.hidden'));
    expect(body).toContain(translate('clubs.settings.invites.replace'));
  });
});

describe('ClubSettings', () => {
  it('keeps the switch for invite links and no link controls (they live in the invite panel)', async () => {
    const on = settings([clubMember({ role: 'ADMIN' })], true);
    expect(on).toMatch(/<input type="checkbox"[^>]*checked/);
    expect(settings([clubMember({ role: 'ADMIN' })], false)).not.toMatch(/<input type="checkbox"[^>]*checked/);
    expect(on).not.toContain(translate('clubs.settings.invites.generate'));
  });

  it('lists the members with role buttons, and says so when the list is not available', async () => {
    const listed = settings([clubMember({ role: 'ADMIN' }), clubMember({ id: 'u2', displayName: 'Bo' })]);
    expect(listed).toContain('Bo');
    expect(listed).toContain(translate('clubs.settings.makeAdmin'));
    const unavailable = settings(undefined);
    expect(unavailable).toContain(translate('clubs.page.membersUnavailable'));
    expect(unavailable).not.toContain(translate('clubs.settings.makeAdmin'));
  });
});
