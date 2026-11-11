import type { ReportDevice, ReportGroup, ReportOccurrence } from '../api/models';
import type { MessageKey } from '../i18n/messages';

export type ReportKind = ReportGroup['kind'];

/** Every kind the API stores, in the order the filter offers them. */
export const REPORT_KINDS: ReportKind[] = ['ERROR', 'WARNING', 'UNHANDLED_REJECTION'];

/** Rows per page of `GET /api/admin/error-reports/{fingerprint}/occurrences` (`ReportAdminService.OCCURRENCE_PAGE_SIZE`). */
export const OCCURRENCE_PAGE_SIZE = 20;

/** The longest search text the API accepts (`ReportAdminService.MAX_QUERY`). */
export const MAX_REPORT_SEARCH = 100;

/** The days the server keeps a report (`glazelab.reports.retention`; the terms promise this number). */
export const REPORT_RETENTION_DAYS = 30;

export const groupIdOf = (group: Pick<ReportGroup, 'fingerprint'>) => group.fingerprint;
export const occurrenceIdOf = (occurrence: Pick<ReportOccurrence, 'id'>) => occurrence.id;

const KIND_KEYS: Record<ReportKind, MessageKey> = {
  ERROR: 'errorReports.kind.error',
  WARNING: 'errorReports.kind.warning',
  UNHANDLED_REJECTION: 'errorReports.kind.rejection',
};
export const kindKey = (kind: ReportKind): MessageKey => KIND_KEYS[kind];

/** The filters of the message list as the page keeps them (`''` is no filter). */
export interface ReportFilter {
  kind: ReportKind | '';
  build: string;
  q: string;
}
export const NO_REPORT_FILTER: ReportFilter = { kind: '', build: '', q: '' };

/** The API's query for a filter: only what is set, the search text stripped. */
export function filterQuery(filter: ReportFilter): { kind?: ReportKind; build?: string; q?: string } {
  const q = filter.q.trim().slice(0, MAX_REPORT_SEARCH);
  return { ...(filter.kind ? { kind: filter.kind } : {}), ...(filter.build ? { build: filter.build } : {}), ...(q ? { q } : {}) };
}

export const isFiltered = (filter: ReportFilter) => Object.keys(filterQuery(filter)).length > 0;

/**
 * The page to ask for next: deletions shift the server's pages forward, so it is derived from how many rows are
 * shown (`appendPage` drops the repeats this asks for).
 */
export const nextOccurrencePage = (shown: number) => Math.floor(shown / OCCURRENCE_PAGE_SIZE);

export const withoutGroup = <T extends Pick<ReportGroup, 'fingerprint'>>(groups: T[], fingerprint: string): T[] =>
  groups.filter((group) => group.fingerprint !== fingerprint);

export const withoutOccurrence = <T extends Pick<ReportOccurrence, 'id'>>(rows: T[], id: string): T[] => rows.filter((row) => row.id !== id);

/** "320 px" or "320 to 1280 px" for the narrowest and widest window the reports came from; null when none said. */
export function viewportRange(group: Pick<ReportGroup, 'minViewportWidth' | 'maxViewportWidth'>): { min: number; max: number } | null {
  const { minViewportWidth: min, maxViewportWidth: max } = group;
  return min == null || max == null ? null : { min, max };
}

/** One browser and OS pair of a group, "Chrome on Android"; either may be unknown. */
export function deviceName(device: Pick<ReportGroup['devices'][number], 'browser' | 'os'>): { browser: string | null; os: string | null } {
  return { browser: device.browser?.trim() || null, os: device.os?.trim() || null };
}

/** A fact of a report's device: its label and either a text or the key of a translated word. */
export interface DeviceFact {
  label: MessageKey;
  text?: string;
  key?: MessageKey;
}

const yesNo = (value: boolean): MessageKey => (value ? 'errorReports.yes' : 'errorReports.no');

/** `UTC+1` style: the report holds `Date.getTimezoneOffset()`, minutes BEHIND UTC. */
export function timezoneText(offsetMinutes: number): string {
  const ahead = -offsetMinutes;
  const sign = ahead < 0 ? '-' : '+';
  const abs = Math.abs(ahead);
  const minutes = abs % 60;
  return `UTC${sign}${Math.floor(abs / 60)}${minutes ? ':' + String(minutes).padStart(2, '0') : ''}`;
}

const join = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(' ');

/** The device facts a report carries, only those the browser could tell, in reading order. */
export function deviceFacts(device: ReportDevice): DeviceFact[] {
  const facts: DeviceFact[] = [];
  const text = (label: MessageKey, value: string | number | null | undefined) => {
    if (value !== null && value !== undefined && value !== '') facts.push({ label, text: String(value) });
  };
  const flag = (label: MessageKey, value: boolean | null | undefined) => {
    if (value !== null && value !== undefined) facts.push({ label, key: yesNo(value) });
  };
  text('errorReports.device.browser', join(device.browser, device.browserVersion));
  text('errorReports.device.os', join(device.os, device.osVersion));
  if (device.screenWidth != null && device.screenHeight != null) text('errorReports.device.screen', `${device.screenWidth} × ${device.screenHeight}`);
  if (device.viewportWidth != null && device.viewportHeight != null) text('errorReports.device.viewport', `${device.viewportWidth} × ${device.viewportHeight}`);
  text('errorReports.device.pixelRatio', device.pixelRatio);
  if (device.pointer) facts.push({ label: 'errorReports.device.pointer', key: POINTER_KEYS[device.pointer] });
  text('errorReports.device.language', device.language);
  flag('errorReports.device.installed', device.standalone);
  flag('errorReports.device.online', device.online);
  text('errorReports.device.connection', device.connection);
  if (device.serviceWorker) facts.push({ label: 'errorReports.device.serviceWorker', key: WORKER_KEYS[device.serviceWorker] });
  flag('errorReports.device.updatePending', device.updatePending);
  flag('errorReports.device.reducedMotion', device.reducedMotion);
  if (device.colorScheme)
    facts.push({ label: 'errorReports.device.colorScheme', key: device.colorScheme === 'DARK' ? 'errorReports.scheme.dark' : 'errorReports.scheme.light' });
  if (device.timezoneOffsetMinutes != null) text('errorReports.device.timezone', timezoneText(device.timezoneOffsetMinutes));
  if (device.deviceMemoryGb != null) text('errorReports.device.memory', `${device.deviceMemoryGb} GB`);
  return facts;
}

const POINTER_KEYS: Record<NonNullable<ReportDevice['pointer']>, MessageKey> = {
  COARSE: 'errorReports.pointer.coarse',
  FINE: 'errorReports.pointer.fine',
  NONE: 'errorReports.pointer.none',
};
const WORKER_KEYS: Record<NonNullable<ReportDevice['serviceWorker']>, MessageKey> = {
  UNSUPPORTED: 'errorReports.worker.unsupported',
  NONE: 'errorReports.worker.none',
  ACTIVE: 'errorReports.worker.active',
};

/** A message shortened for a button's accessible name (the whole message stays on the page). */
export function excerpt(message: string, max = 60): string {
  const single = message.replace(/\s+/g, ' ').trim();
  const chars = [...single];
  return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : single;
}
