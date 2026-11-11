import { beforeAll, describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { setLocale, translate } from '../../lib/i18n';
import { club, clubMember, combination, stockItem } from '../../test/fixtures';
import ClubCard from './ClubCard.svelte';

const admin = clubMember({ id: 'u1', role: 'ADMIN' });
const member = clubMember({ id: 'u2', displayName: 'Bo' });
const stock = [
  stockItem({ id: 's1', clubId: 'c1', quantityG: 50 }),
  stockItem({ id: 's2', clubId: 'c1', quantityG: 0 }),
  stockItem({ id: 's3', clubId: 'c2', quantityG: 5 }),
];
const combinations = [combination({ id: 'a', authorId: 'u1' }), combination({ id: 'b', authorId: 'u2' }), combination({ id: 'c', authorId: 'u9' })];

const card = (_: object = {}, props: Record<string, unknown> = {}) =>
  render(ClubCard, {
    props: {
      club: club({ name: 'Sunday <Clay>' }),
      members: [admin, member],
      userId: 'u1',
      stock,
      combinations,
      online: true,
      leaveClub: async () => true,
      formError: null,
      ...props,
    },
  }).body;

beforeAll(() => setLocale('en'));

describe('ClubCard', () => {
  it('is a link to the club page with the name as an h2 inside it, and has no separate "Club combinations" button', () => {
    const body = card();
    expect(body).toMatch(/<a[^>]*href="#\/clubs\/c1"[^>]*>\s*<h2[^>]*>Sunday &lt;Clay><\/h2>\s*<\/a>/);
    expect(body.match(/<a\b/g)).toHaveLength(1);
    expect(body).not.toContain('Club combinations');
  });

  it('says what the page holds: members, glazes in stock on the club shelf, combinations by current members', () => {
    expect(
      card()
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' '),
    ).toContain('2 members · 1 glaze on the shelf · 2 combinations');
  });

  it('leaves out the counts whose member list is unavailable, but keeps the shelf count', () => {
    const body = card({}, { members: undefined });
    expect(body).toContain('1 glaze on the shelf');
    expect(body).not.toMatch(/members|combination/);
  });

  it('shows the Admin badge for admins only', () => {
    expect(card({}, { club: club({ role: 'ADMIN' }) })).toContain(`>${translate('clubs.role.admin')}</span>`);
    expect(card({}, { club: club({ role: 'MEMBER' }) })).not.toContain(translate('clubs.role.admin'));
  });

  it('describes a refused "Leave club" with one short line (the only admin; the only member) and none otherwise', () => {
    const lastAdmin = card({}, { members: [admin, member] });
    expect(lastAdmin).toMatch(/aria-disabled="true"/);
    expect(lastAdmin).toContain(translate('clubs.leave.lastAdmin'));
    const reason = /aria-describedby="([^"]+)"/.exec(lastAdmin)?.[1];
    expect(reason).toBeTruthy();
    expect(lastAdmin).toMatch(new RegExp(`<p[^>]*id="${reason}"[^>]*>${translate('clubs.leave.lastAdmin')}`));
    const only = card({}, { members: [admin] });
    expect(only).toContain(translate('clubs.leave.onlyMember'));
    const free = card({}, { members: [admin, clubMember({ id: 'u3', role: 'ADMIN' })] });
    expect(free).not.toContain('aria-disabled');
    expect(free).not.toContain('aria-describedby');
    expect(free).not.toContain(translate('clubs.leave.lastAdmin'));
  });
});
