/** An ISO-8601 date and time; the zone (`Z` or an offset) is optional only so that older saved values still parse. */
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/;

/**
 * An API time in milliseconds, null when it is no date and time. The API answers instants with `Z`; snapshots saved
 * before sync format 2 hold zone-less combination times, which the API wrote in its own zone (UTC in production), so a
 * value without a zone is read as UTC, never in the reader's zone.
 */
export function instantTime(text: string | null | undefined): number | null {
  const match = text ? DATE_TIME.exec(text) : null;
  if (!match || !text) return null;
  const value = Date.parse(match[3] ? text : `${text}Z`);
  return Number.isNaN(value) ? null : value;
}
