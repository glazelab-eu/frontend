import type { MessageKey } from '../i18n';
import { browserHeic, looksHeic, type HeicBrowser } from '../images/heic';

/** The API's limit (`Feedback.MAX_MESSAGE`), counted after trimming. */
export const MAX_FEEDBACK_LENGTH = 2000;
/** The API's limit (`FeedbackPhoto.MAX_PHOTOS`). */
export const MAX_FEEDBACK_PHOTOS = 3;
/** A photo is shrunk on the device to the API's photo size (`ImageEncoder.MAX_SIDE`) before sending, so three fit one request. */
export const FEEDBACK_PHOTO_SIDE = 1600;
/** Each shrunk photo stays below this, so the request stays under the API's 12 MB multipart limit. */
export const MAX_FEEDBACK_PHOTO_BYTES = 3_500_000;
/** What may be chosen at all: the device decodes it before sending (a phone's photo can be large). */
export const MAX_FEEDBACK_SOURCE_BYTES = 40_000_000;
/** JPEG qualities tried in turn until the shrunk photo fits. */
const QUALITIES = [0.85, 0.75, 0.6] as const;

export type FeedbackDevice = 'PHONE' | 'TABLET' | 'DESKTOP';

/** What the app attaches unless the sender unticks it: the route NAME (never the link, ids or tokens), build, language, device class. */
export interface FeedbackContext {
  route: string;
  build: string;
  language: string;
  device: FeedbackDevice;
}

export const deviceKey = (device: FeedbackDevice): MessageKey =>
  device === 'PHONE' ? 'feedback.device.phone' : device === 'TABLET' ? 'feedback.device.tablet' : 'feedback.device.desktop';

/** A phone-wide window is a phone; another touch screen a tablet; a fine pointer a desktop. */
export function deviceClass(phone: boolean, coarse: boolean): FeedbackDevice {
  if (phone) return 'PHONE';
  return coarse ? 'TABLET' : 'DESKTOP';
}

/** The context for a route name (only names of the API's shape pass: lower case, digits, hyphens). */
export function feedbackContext(input: { route: string; build: string; language: string; phone: boolean; coarse: boolean }): FeedbackContext {
  const route = /^[a-z][a-z0-9-]{0,39}$/.test(input.route) ? input.route : 'unknown';
  return { route, build: input.build, language: input.language, device: deviceClass(input.phone, input.coarse) };
}

/** The draft the app keeps until it is sent (memory only, per account): text, photos and whether the context goes with it. */
export interface FeedbackDraft {
  message: string;
  photos: File[];
  withContext: boolean;
}

export const emptyFeedbackDraft = (): FeedbackDraft => ({ message: '', photos: [], withContext: true });

export const isEmptyDraft = (draft: FeedbackDraft) => !draft.message.trim() && !draft.photos.length;

/** Why the text cannot be sent yet, or null. */
export function messageProblem(message: string): MessageKey | null {
  const text = message.trim();
  if (!text) return 'feedback.problem.empty';
  if (text.length > MAX_FEEDBACK_LENGTH) return 'feedback.problem.tooLong';
  return null;
}

/** Why a chosen file is refused before anything is decoded, or null. */
export function photoProblem(file: Pick<File, 'type' | 'name' | 'size'>, chosen: number): MessageKey | null {
  if (chosen >= MAX_FEEDBACK_PHOTOS) return 'feedback.problem.tooManyPhotos';
  if (!file.type.startsWith('image/') && !looksHeic(file)) return 'feedback.problem.notImage';
  if (file.size === 0 || file.size > MAX_FEEDBACK_SOURCE_BYTES) return 'feedback.problem.photoTooLarge';
  return null;
}

/** The size to draw at: at most `FEEDBACK_PHOTO_SIDE` on the long side, never enlarged. */
export function shrunkSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, FEEDBACK_PHOTO_SIDE / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export type PreparedPhoto = { ok: true; file: File } | { ok: false; reason: MessageKey };

/**
 * The photo as it is sent: decoded upright on the device (HEIC too where the browser can), at most 1600 px, re-encoded as a JPEG
 * without metadata (the API strips it again). Never throws; a photo the browser cannot read is refused, never sent as it is.
 */
export async function preparePhoto(file: File, browser: HeicBrowser = browserHeic): Promise<PreparedPhoto> {
  let photo;
  try {
    photo = await browser.decode(file);
  } catch {
    return { ok: false, reason: 'feedback.problem.unreadable' };
  }
  try {
    if (!(photo.width > 0 && photo.height > 0)) return { ok: false, reason: 'feedback.problem.unreadable' };
    const { width, height } = shrunkSize(photo.width, photo.height);
    for (const quality of QUALITIES) {
      const blob = await browser.encode(photo, width, height, quality);
      if (!blob || blob.size === 0) return { ok: false, reason: 'feedback.problem.unreadable' };
      if (blob.size <= MAX_FEEDBACK_PHOTO_BYTES) return { ok: true, file: new File([blob], 'photo.jpg', { type: 'image/jpeg' }) };
    }
    return { ok: false, reason: 'feedback.problem.photoTooLarge' };
  } catch {
    return { ok: false, reason: 'feedback.problem.unreadable' };
  } finally {
    photo.close();
  }
}
