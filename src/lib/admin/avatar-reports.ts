import type { AvatarReport } from '../api/models';
import type { MessageKey } from '../i18n/messages';

/** The statuses the queue can be narrowed to; `undefined` lists them all. */
export type AvatarReportStatus = AvatarReport['status'];
export type AvatarReportFilter = AvatarReportStatus | 'ALL';

/** What the queue shows first: the reports nobody decided yet. */
export const DEFAULT_REPORT_FILTER: AvatarReportFilter = 'OPEN';

/** The `status` query of a filter (`ALL` asks for no narrowing). */
export const filterStatus = (filter: AvatarReportFilter): AvatarReportStatus | undefined => (filter === 'ALL' ? undefined : filter);

/**
 * The reports of one picture. The API answers one report per reporter; a decision applies to every open report of the same picture,
 * so the page shows one entry per picture (`avatarId`) with its reports under it.
 */
export interface ReportedPicture {
  avatarId: string;
  /** Newest first, as the API lists them. */
  reports: AvatarReport[];
  owner: string | null;
  ownerId: string | null;
  /** Where the picture is now (the same for every report of it). */
  picture: AvatarReport['picture'];
  /** Whether the admin picture endpoint can still show it (kept evidence has an end). */
  hasPicture: boolean;
  /**
   * `OPEN` while any report is open, else `ACTIONED` if a decision removed it, else `DISMISSED` if one let it stay, else `CLOSED`
   * (nobody decided: the picture went with its account, or its reports expired after 90 days).
   */
  status: AvatarReportStatus;
  /** A report of the picture that is still open (any open one decides them all), if there is one. */
  open: AvatarReport | undefined;
  /** The report whose picture endpoint shows the picture: the newest one. */
  evidenceId: string;
  /** Who decided and when (the latest closed report), for a decided picture. */
  closedAt: string | null;
  closedBy: string | null;
}

/** Groups the shown reports by picture, in the order their first (newest) report appears. */
export function groupReports(reports: readonly AvatarReport[]): ReportedPicture[] {
  const groups = new Map<string, AvatarReport[]>();
  for (const report of reports) {
    const group = groups.get(report.avatarId);
    if (group) group.push(report);
    else groups.set(report.avatarId, [report]);
  }
  return [...groups.entries()].map(([avatarId, list]) => {
    const open = list.find((report) => report.status === 'OPEN');
    const closed = list.filter((report) => report.closedAt).sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? ''))[0];
    const first = list[0];
    return {
      avatarId,
      reports: list,
      owner: first.owner,
      ownerId: first.ownerId,
      picture: first.picture,
      hasPicture: first.hasPicture,
      status: open ? 'OPEN' : ((['ACTIONED', 'DISMISSED'] as const).find((status) => list.some((report) => report.status === status)) ?? 'CLOSED'),
      open,
      evidenceId: first.id,
      closedAt: closed?.closedAt ?? null,
      closedBy: closed?.closedBy ?? null,
    };
  });
}

/** What an admin reads about where the reported picture is now. */
export function pictureStateKey(picture: AvatarReport['picture']): MessageKey {
  switch (picture) {
    case 'CURRENT':
      return 'avatars.reports.state.current';
    case 'REPLACED':
      return 'avatars.reports.state.replaced';
    case 'OWNER_REMOVED':
      return 'avatars.reports.state.ownerRemoved';
    case 'ADMIN_REMOVED':
      return 'avatars.reports.state.adminRemoved';
    default:
      return 'avatars.reports.state.accountDeleted';
  }
}

/** The status of a reported picture as a label. */
export function statusKey(status: AvatarReportStatus): MessageKey {
  switch (status) {
    case 'OPEN':
      return 'avatars.reports.status.open';
    case 'ACTIONED':
      return 'avatars.reports.status.actioned';
    case 'CLOSED':
      return 'avatars.reports.status.closed';
    default:
      return 'avatars.reports.status.dismissed';
  }
}

/**
 * What the queue shows where the picture would be once it cannot show it: the account's deletion (or ban) deletes its pictures and
 * every kept copy (the owner is gone: `ownerId` is set on every report while the account exists); otherwise the kept copy expired.
 */
export function missingPictureKey(group: Pick<ReportedPicture, 'ownerId'>): MessageKey {
  return group.ownerId ? 'avatars.reports.noPicture' : 'avatars.reports.deletedWithAccount';
}

/**
 * Whether a site admin can still remove the picture from the queue entry: the open reports decide it (`POST …/remove`), and a picture
 * whose reports were dismissed or expired (`CLOSED` while it is still shown) can be removed with the picture's own `DELETE` (the API
 * never reopens reports).
 */
export function canRemove(group: Pick<ReportedPicture, 'status' | 'picture'>): 'decide' | 'delete' | null {
  if (group.status === 'OPEN') return 'decide';
  return (group.status === 'DISMISSED' || group.status === 'CLOSED') && group.picture === 'CURRENT' ? 'delete' : null;
}
