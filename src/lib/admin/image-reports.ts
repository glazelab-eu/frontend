import { instantTime } from '../api/instant';
import type { ImageDeletion, ImageReport } from '../api/models';
import type { MessageKey } from '../i18n/messages';
import type { Route } from '../routing/routes';

/** Rows per page of `GET /api/admin/image-reports` (the API's admin page size). */
export const REPORT_PAGE_SIZE = 50;

export const reportIdOf = (report: Pick<ImageReport, 'id'>) => report.id;

/**
 * The page an admin opens for a report: the reported photo's glaze or combination, its carousel at that photo
 * (when the listing holds a photo the admin may see; the carousel stays on its first photo otherwise).
 */
export function reportTarget(report: Pick<ImageReport, 'glazeId' | 'combinationId' | 'imageId'>): Route {
  if (report.glazeId) return { name: 'glaze', id: report.glazeId, photo: report.imageId };
  if (report.combinationId) return { name: 'combination', id: report.combinationId, photo: report.imageId };
  return { name: 'not-found' };
}

/**
 * Where an admin's thumbnail of a reported photo comes from: only a PUBLIC photo has one. The bytes of a
 * club or private photo are never requested for the queue (Q11), so no other report even gets a URL.
 */
export function reportPhotoUrl(report: Pick<ImageReport, 'imageId' | 'visibility'>): string | null {
  return report.visibility === 'PUBLIC' ? `/api/images/${report.imageId}/card` : null;
}

/** What an admin reads for a photo's visibility (the uploader's words, "Only me", do not fit an admin). */
export function adminVisibilityKey(visibility: string): MessageKey {
  if (visibility === 'PUBLIC') return 'images.log.public';
  return visibility === 'CLUB' ? 'images.log.club' : 'images.log.private';
}

/** The ID row of a deleted photo's item, left out when the log kept neither a glaze nor a combination. */
export function deletionItem(row: Pick<ImageDeletion, 'glazeId' | 'combinationId'>): { label: MessageKey; id: string } | null {
  if (row.glazeId) return { label: 'images.log.glaze', id: row.glazeId };
  return row.combinationId ? { label: 'images.log.combination', id: row.combinationId } : null;
}

/**
 * A server timestamp for the admin pages: date and time in the reader's language, in UTC with the zone shown,
 * so the "(server time)" of the row labels is what the text says. A value that is no date stays as it came.
 */
export function formatServerTime(instant: string, locale: string): string {
  const value = instantTime(instant);
  if (value === null) return instant;
  const time = new Date(value);
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(time);
}

/** The queue after a dismissal: only that report leaves. */
export function withoutReport<T extends Pick<ImageReport, 'id'>>(reports: T[], id: string): T[] {
  return reports.filter((report) => report.id !== id);
}

/** The queue after a photo's deletion: the API resolves every report of that photo with it. */
export function withoutPhoto<T extends Pick<ImageReport, 'imageId'>>(reports: T[], imageId: string): T[] {
  return reports.filter((report) => report.imageId !== imageId);
}

/**
 * The page that holds the first report not shown yet. Dismissals and deletions shift later reports
 * forward on the server, so "the next page" would skip some; `appendPage` drops the repeats this asks for.
 */
export function nextReportPage(shown: number): number {
  return Math.floor(shown / REPORT_PAGE_SIZE);
}
