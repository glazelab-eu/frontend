import type { MessageKey } from '../i18n';
import type { Focus } from './photo-focus';
import type { ImageInfo, UploadTarget } from '../api/models';
import { MAX_HEIC_BYTES, looksHeic } from './heic';
import type { PhotoAudience } from './photo-audience';
import { kindsOn } from './pictures';

export type UploadKind = ImageInfo['kind'];
export type UploadVisibility = ImageInfo['visibility'];

/** The largest photo the API takes (`ImageEncoder.MAX_BYTES`, decimal megabytes); its message is `errors.imageTooBig`. */
export const MAX_UPLOAD_BYTES = 12_000_000;
/** Photos in one dialog; previews of large photos are decoded in memory, so the queue stays short. */
export const MAX_UPLOAD_FILES = 10;
/** Visibility of the first upload of a session. */
export const DEFAULT_UPLOAD_VISIBILITY: UploadVisibility = 'PUBLIC';

/** Why a chosen file never joins the queue. */
/** `heic`: a HEIC/HEIF photo this browser cannot convert to JPEG (it is never sent as it is). */
export type Rejection = 'empty' | 'notImage' | 'tooLarge' | 'tooMany' | 'heic';

export interface Rejected {
  name: string;
  reason: Rejection;
}

/** `converting`: a HEIC photo on its way to JPEG, not sendable yet; `idle`: chosen, not sent; `queued`: waiting for its turn in a running batch. */
export type UploadStatus = 'converting' | 'idle' | 'queued' | 'uploading' | 'done' | 'failed';

export interface UploadItem {
  /** Stable across removals, so a row keeps its state and focus. */
  key: number;
  file: File;
  kind: UploadKind;
  caption: string;
  firedOn: string;
  status: UploadStatus;
  /** A server message or message key of the last failure; empty unless `failed`. */
  error: string;
  /** Where the cards' covers centre the photo (sent with it; the photo stays whole); null for the centre. */
  focus: Focus | null;
}

export interface UploadQueue {
  items: UploadItem[];
  nextKey: number;
  /** A batch is going: `queued` files are taken one at a time until none is left or it is cancelled. */
  running: boolean;
}

export const emptyQueue: UploadQueue = { items: [], nextKey: 1, running: false };

/** The kinds a target may be given: Packaging belongs to glazes only, Work in progress to combinations only. */
export function kindsFor(target: Pick<UploadTarget, 'type'>): UploadKind[] {
  return kindsOn(target.type === 'glaze');
}

/** The kind a new file starts with: the one the opener asked for when the target allows it, else Test tile. */
export function defaultKind(target: Pick<UploadTarget, 'type'> & { kind?: UploadKind }): UploadKind {
  return target.kind && kindsFor(target).includes(target.kind) ? target.kind : 'TEST_TILE';
}

/**
 * The visibility a dialog starts with: the session's last choice when `audience` offers it. Club without a club to
 * choose falls back to Only me (the writer meant to keep photos within a club, so it never widens to everyone);
 * where Only me is not offered (someone else's combination) the narrowest choice left is taken: a club, else Everyone.
 */
export function startVisibility(remembered: UploadVisibility, audience: Pick<PhotoAudience, 'private' | 'clubs'>): UploadVisibility {
  const narrowest = audience.clubs.length > 0 ? 'CLUB' : 'PUBLIC';
  if (remembered === 'PRIVATE') return audience.private ? 'PRIVATE' : narrowest;
  if (remembered === 'CLUB' && audience.clubs.length === 0) return audience.private ? 'PRIVATE' : 'PUBLIC';
  return remembered;
}

/**
 * Why a file cannot be uploaded, or null. A file without a type is left to the API. A HEIC/HEIF photo may be larger
 * than the API's limit (`MAX_HEIC_BYTES`): the JPEG made from it is checked instead.
 */
export function rejectionOf(file: Pick<File, 'type' | 'size'> & { name?: string }): Rejection | null {
  if (file.size === 0) return 'empty';
  if (looksHeic({ type: file.type, name: file.name ?? '' })) return file.size > MAX_HEIC_BYTES ? 'tooLarge' : null;
  if (file.type && !file.type.startsWith('image/')) return 'notImage';
  if (file.size > MAX_UPLOAD_BYTES) return 'tooLarge';
  return null;
}

/** Adds the acceptable files, in order, and names the others; files beyond the limit are rejected as 'tooMany'. HEIC photos wait as `converting`. */
export function addFiles(queue: UploadQueue, files: readonly File[], kind: UploadKind): { queue: UploadQueue; rejected: Rejected[] } {
  const items = [...queue.items];
  const rejected: Rejected[] = [];
  let nextKey = queue.nextKey;
  for (const file of files) {
    const reason = rejectionOf(file) ?? (items.length >= MAX_UPLOAD_FILES ? 'tooMany' : null);
    if (reason) rejected.push({ name: file.name, reason });
    else
      items.push({
        key: nextKey++,
        file,
        kind,
        caption: '',
        firedOn: '',
        status: looksHeic(file) ? 'converting' : 'idle',
        error: '',
        focus: null,
      });
  }
  return { queue: { ...queue, items, nextKey }, rejected };
}

function change(queue: UploadQueue, key: number, update: (item: UploadItem) => UploadItem): UploadQueue {
  return { ...queue, items: queue.items.map((item) => (item.key === key ? update(item) : item)) };
}

/** Edits a file's own fields while it has not been sent (or after a failure). */
export function editItem(queue: UploadQueue, key: number, fields: Partial<Pick<UploadItem, 'kind' | 'caption' | 'firedOn'>>): UploadQueue {
  return change(queue, key, (item) => (item.status === 'uploading' || item.status === 'done' ? item : { ...item, ...fields }));
}

/** Drops a file from the list; the one being sent cannot be taken back. */
export function removeItem(queue: UploadQueue, key: number): UploadQueue {
  const item = queue.items.find((candidate) => candidate.key === key);
  return !item || item.status === 'uploading' ? queue : { ...queue, items: queue.items.filter((candidate) => candidate.key !== key) };
}

/** A converted photo replaces its HEIC file and becomes sendable; a vanished item (removed meanwhile) stays gone. */
export function converted(queue: UploadQueue, key: number, file: File): UploadQueue {
  return change(queue, key, (item) => (item.status === 'converting' ? { ...item, file, status: 'idle' } : item));
}

const unsent = (item: Pick<UploadItem, 'status'>) => item.status === 'idle' || item.status === 'failed';

/** A photo's focus can be set (or reset) while it is chosen and not under way: not converting, waiting, in flight or stored. */
export const canFocus = (item: Pick<UploadItem, 'status'>) => unsent(item);

/** The focus the photo is sent with; null resets it to the centre. */
export function focused(queue: UploadQueue, key: number, focus: Focus | null): UploadQueue {
  const item = queue.items.find((candidate) => candidate.key === key);
  if (!item || !canFocus(item) || (item.focus?.x === focus?.x && item.focus?.y === focus?.y)) return queue;
  return change(queue, key, (current) => ({ ...current, focus: focus && { x: focus.x, y: focus.y } }));
}

/** Number of files "Upload" would send: those not yet sent and those that failed. */
export function sendable(queue: UploadQueue): number {
  return queue.items.filter(unsent).length;
}

/** Starts a batch: every unsent file waits for its turn. Nothing changes while a batch runs or when there is nothing to send. */
export function start(queue: UploadQueue): UploadQueue {
  if (queue.running || sendable(queue) === 0) return queue;
  return { ...queue, running: true, items: queue.items.map((item) => (unsent(item) ? { ...item, status: 'queued', error: '' } : item)) };
}

/** Sends one file again (the Retry control); starts a batch if none is running. */
export function retryItem(queue: UploadQueue, key: number): UploadQueue {
  const item = queue.items.find((candidate) => candidate.key === key);
  if (!item || item.status !== 'failed') return queue;
  return { ...change(queue, key, (current) => ({ ...current, status: 'queued', error: '' })), running: true };
}

/** The file to send next: the first one waiting, never while another is being sent (one request at a time). */
export function nextToUpload(queue: UploadQueue): UploadItem | null {
  if (!queue.running || queue.items.some((item) => item.status === 'uploading')) return null;
  return queue.items.find((item) => item.status === 'queued') ?? null;
}

export function markUploading(queue: UploadQueue, key: number): UploadQueue {
  return change(queue, key, (item) => ({ ...item, status: 'uploading', error: '' }));
}

export function markDone(queue: UploadQueue, key: number): UploadQueue {
  return change(queue, key, (item) => ({ ...item, status: 'done', error: '' }));
}

export function markFailed(queue: UploadQueue, key: number, error: string): UploadQueue {
  return change(queue, key, (item) => ({ ...item, status: 'failed', error }));
}

/** Ends the batch: waiting files go back to unsent, the one being sent finishes, finished ones stay. */
export function stop(queue: UploadQueue): UploadQueue {
  return { ...queue, running: false, items: queue.items.map((item) => (item.status === 'queued' ? { ...item, status: 'idle' } : item)) };
}

/** Ends the batch once nothing is waiting or being sent. */
export function settle(queue: UploadQueue): UploadQueue {
  return queue.running && !queue.items.some((item) => item.status === 'queued' || item.status === 'uploading') ? { ...queue, running: false } : queue;
}

export interface UploadSummary {
  total: number;
  done: number;
  failed: number;
  /** Files still to send in this batch: waiting or being sent. */
  pending: number;
  /** Not started and not failed: chosen but never sent. */
  idle: number;
  /** HEIC photos still being converted. */
  converting: number;
  /** 1-based position of the file being sent among the batch's files (done, sending and waiting), 0 when none. */
  position: number;
  /** Files in the batch: those sent, sending or waiting. */
  batch: number;
}

export function summary(queue: UploadQueue): UploadSummary {
  const count = (status: UploadStatus) => queue.items.filter((item) => item.status === status).length;
  const done = count('done');
  const uploading = count('uploading');
  const queued = count('queued');
  return {
    total: queue.items.length,
    done,
    failed: count('failed'),
    pending: uploading + queued,
    idle: count('idle'),
    converting: count('converting'),
    position: uploading ? done + 1 : 0,
    batch: done + uploading + queued,
  };
}

/** The one progress line of an upload list (a `status` region): sending, stopping, the result, or converting; null when there is nothing to say. */
export function uploadProgress(counts: UploadSummary, running: boolean): { key: MessageKey; values?: Record<string, number> } | null {
  if (running && counts.position > 0) return { key: 'upload.uploading', values: { position: counts.position, total: counts.batch } };
  if (!running && counts.pending > 0) return { key: 'upload.stopping' };
  if (!running && (counts.done > 0 || counts.failed > 0)) return { key: 'upload.result', values: { done: counts.done, failed: counts.failed } };
  if (counts.converting > 0) return { key: 'upload.converting' };
  return null;
}

/** Every file went through and none failed or waits: the dialog may close itself. */
export function allDone(queue: UploadQueue): boolean {
  return queue.items.length > 0 && queue.items.every((item) => item.status === 'done');
}

/** What one upload answers: done (the picture is in the listings), or why not and whether later files would fail the same way. */
export type UploadResult = { ok: true } | { ok: false; message: string; stop: boolean };

/** A file size for the list: kilobytes below 1 MB, else megabytes with one decimal (decimal units, like the 12 MB limit). */
export function fileSizeLabel(bytes: number, locale?: string): string {
  const format = (value: number, unit: string) => `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)} ${unit}`;
  return bytes < 1_000_000 ? format(Math.max(1, Math.round(bytes / 1000)), 'KB') : format(bytes / 1_000_000, 'MB');
}
