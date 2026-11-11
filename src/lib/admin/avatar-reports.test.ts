import { describe, expect, it } from 'vitest';
import type { AvatarReport } from '../api/models';
import { canRemove, filterStatus, groupReports, missingPictureKey, pictureStateKey, statusKey } from './avatar-reports';

const report = (overrides: Partial<AvatarReport> = {}): AvatarReport => ({
  id: 'r1',
  avatarId: 'a1',
  ownerId: 'u2',
  owner: 'Ada',
  reporter: 'Bo',
  reason: 'Shows someone else',
  createdAt: '2026-11-01T10:00:00Z',
  status: 'OPEN',
  closedAt: null,
  closedBy: null,
  picture: 'CURRENT',
  hasPicture: true,
  ...overrides,
});

describe('the report queue of profile pictures', () => {
  it('shows one entry per picture, with its reports newest first, in the order the pictures first appear', () => {
    const groups = groupReports([
      report({ id: 'r3', avatarId: 'a2', owner: 'Cy', ownerId: 'u3' }),
      report({ id: 'r2', avatarId: 'a1' }),
      report({ id: 'r1', avatarId: 'a1', reporter: 'Di' }),
    ]);
    expect(groups.map((group) => [group.avatarId, group.reports.map((entry) => entry.id)])).toEqual([
      ['a2', ['r3']],
      ['a1', ['r2', 'r1']],
    ]);
    expect(groups[1]).toMatchObject({ owner: 'Ada', ownerId: 'u2', evidenceId: 'r2', open: expect.objectContaining({ id: 'r2' }) });
  });

  it('is open while any report is open, removed when a decision removed it, else dismissed', () => {
    const closed = { closedAt: '2026-11-02T10:00:00Z', closedBy: 'Root' };
    expect(groupReports([report({ id: 'r2', status: 'DISMISSED', ...closed }), report({ id: 'r1' })])[0]).toMatchObject({ status: 'OPEN', open: { id: 'r1' } });
    expect(groupReports([report({ status: 'ACTIONED', picture: 'ADMIN_REMOVED', ...closed })])[0]).toMatchObject({ status: 'ACTIONED', open: undefined });
    expect(groupReports([report({ status: 'DISMISSED', ...closed })])[0]).toMatchObject({ status: 'DISMISSED', closedBy: 'Root' });
    // Closed without a decision (with the account, or expired): only when nobody decided any of its reports.
    const gone = { closedAt: '2026-11-04T10:00:00Z', closedBy: null, owner: null, ownerId: null, picture: 'ACCOUNT_DELETED' as const };
    expect(groupReports([report({ id: 'r2', status: 'CLOSED', ...gone })])[0]).toMatchObject({ status: 'CLOSED', open: undefined });
    expect(groupReports([report({ id: 'r2', status: 'CLOSED', ...gone }), report({ id: 'r1', status: 'DISMISSED', ...closed })])[0]).toMatchObject({
      status: 'DISMISSED',
    });
    expect(canRemove({ status: 'CLOSED', picture: 'ACCOUNT_DELETED' })).toBeNull();
    // Expired reports of a picture that is still shown: no decision is left, but the picture's own removal is.
    expect(canRemove({ status: 'CLOSED', picture: 'CURRENT' })).toBe('delete');
    expect(canRemove({ status: 'CLOSED', picture: 'REPLACED' })).toBeNull();
  });

  it('says why a picture cannot be shown: deleted with its account, or no longer kept', () => {
    expect(missingPictureKey({ ownerId: null })).toBe('avatars.reports.deletedWithAccount');
    expect(missingPictureKey({ ownerId: 'u1' })).toBe('avatars.reports.noPicture');
  });

  it('keeps what is known of a decided picture: who decided last and when, and the evidence after the picture is gone', () => {
    const [group] = groupReports([
      report({ id: 'r2', status: 'ACTIONED', closedAt: '2026-11-03T10:00:00Z', closedBy: 'Root', picture: 'REPLACED' }),
      report({ id: 'r1', status: 'ACTIONED', closedAt: '2026-11-02T10:00:00Z', closedBy: 'Other', picture: 'REPLACED' }),
    ]);
    expect(group).toMatchObject({ closedAt: '2026-11-03T10:00:00Z', closedBy: 'Root', picture: 'REPLACED', hasPicture: true });
  });

  it('keeps a deleted owner without a name and an ID', () => {
    expect(groupReports([report({ owner: null, ownerId: null, picture: 'ACCOUNT_DELETED' })])[0]).toMatchObject({
      owner: null,
      ownerId: null,
      picture: 'ACCOUNT_DELETED',
    });
  });

  it('says where each picture is now', () => {
    expect((['CURRENT', 'REPLACED', 'OWNER_REMOVED', 'ADMIN_REMOVED', 'ACCOUNT_DELETED'] as const).map((picture) => pictureStateKey(picture))).toEqual([
      'avatars.reports.state.current',
      'avatars.reports.state.replaced',
      'avatars.reports.state.ownerRemoved',
      'avatars.reports.state.adminRemoved',
      'avatars.reports.state.accountDeleted',
    ]);
    expect([statusKey('OPEN'), statusKey('DISMISSED'), statusKey('ACTIONED'), statusKey('CLOSED')]).toEqual([
      'avatars.reports.status.open',
      'avatars.reports.status.dismissed',
      'avatars.reports.status.actioned',
      'avatars.reports.status.closed',
    ]);
  });

  it('offers removal while reports are open (also for a gone picture: it is blocked), and for a dismissed picture that is still shown', () => {
    expect(canRemove({ status: 'OPEN', picture: 'CURRENT' })).toBe('decide');
    expect(canRemove({ status: 'OPEN', picture: 'REPLACED' })).toBe('decide');
    expect(canRemove({ status: 'OPEN', picture: 'ACCOUNT_DELETED' })).toBe('decide');
    expect(canRemove({ status: 'DISMISSED', picture: 'CURRENT' })).toBe('delete');
    expect(canRemove({ status: 'DISMISSED', picture: 'REPLACED' })).toBeNull();
    expect(canRemove({ status: 'ACTIONED', picture: 'ADMIN_REMOVED' })).toBeNull();
  });

  it('asks for no narrowing under All', () => {
    expect(filterStatus('ALL')).toBeUndefined();
    expect(filterStatus('OPEN')).toBe('OPEN');
  });
});
