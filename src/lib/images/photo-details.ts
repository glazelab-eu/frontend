import type { ImageInfo } from '../api/models';
import type { ImageDetailsChange } from '../api/inputs';

/** Longest caption the API accepts (`PhotoDetails.MAX_CAPTION`), counted like `maxlength`. */
export const MAX_CAPTION = 200;

/** The firing dates the API accepts (`PhotoDetails.EARLIEST`/`LATEST`), as `min` and `max` of a date input. */
export const EARLIEST_FIRED_ON = '1900-01-01';
export const LATEST_FIRED_ON = '2100-12-31';

/** The editable fields as the form holds them: text and a date input's `YYYY-MM-DD` or empty (the kind has its own dialog). */
export interface PhotoDetailsDraft {
  caption: string;
  firedOn: string;
}

/** The form's start: the photo's own values, empty text and date for none. */
export function detailsDraft(image: Pick<ImageInfo, 'caption' | 'firedOn'>): PhotoDetailsDraft {
  return { caption: image.caption ?? '', firedOn: image.firedOn ?? '' };
}

/**
 * The request for a draft: only the fields that differ from the photo (the API keeps what is absent),
 * a blank caption or empty date as an explicit null that clears it. Null when nothing changed.
 */
export function detailsChange(image: Pick<ImageInfo, 'caption' | 'firedOn'>, draft: PhotoDetailsDraft): ImageDetailsChange | null {
  const change: ImageDetailsChange = {};
  const caption = draft.caption.trim() || null;
  if (caption !== (image.caption ?? null)) change.caption = caption;
  const firedOn = draft.firedOn || null;
  if (firedOn !== (image.firedOn ?? null)) change.firedOn = firedOn;
  return Object.keys(change).length ? change : null;
}
