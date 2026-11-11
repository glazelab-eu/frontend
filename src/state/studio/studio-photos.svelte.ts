import type { ImageUploadInput } from '../../lib/api/inputs';
import type { HeicResult } from '../../lib/images/heic';
import type { UploadResult, UploadVisibility } from '../../lib/images/upload-queue';
import { createUploadSession } from '../images/upload-session.svelte';

/**
 * `editing`: photos are only chosen; `saving`: the combination's save is out; `uploading`: it is saved and its photos go
 * one at a time; `failed`: saved, but some photos did not go (Retry, or Done to leave without them); `done`: all went.
 */
export type StudioPhotosPhase = 'editing' | 'saving' | 'uploading' | 'failed' | 'done';

interface Options {
  /** Sends one photo and patches it into the listings (`app.uploadImage`); never throws for a failed upload. */
  upload: (input: ImageUploadInput) => Promise<UploadResult>;
  /** Visibility and club of the photos, read as each one goes out. */
  common: () => { visibility: UploadVisibility; clubId: string };
  /** Every photo is stored on the saved combination (after the first batch or a retry). */
  onDone: (id: string) => void;
  /** Photos were left unsent because the page went away while the save or the uploads ran. */
  onDropped: () => void;
  convert?: (file: File) => Promise<HeicResult>;
  createUrl?: (file: File) => string;
  revokeUrl?: (url: string) => void;
}

/**
 * The photos a Studio form holds while recording: chosen files live in memory only (never in the recovery record, a
 * snapshot or any device storage) and go only after the combination is saved, one request at a time through the upload
 * dialog's session. A failure never undoes the save: the failed photos stay with Retry. Leaving lets the photo in flight
 * finish (it may be stored already) and drops the rest; `reset` (an account change) drops everything at once.
 */
export function createStudioPhotos({ upload, common, onDone, onDropped, convert, createUrl, revokeUrl }: Options) {
  let phase = $state<StudioPhotosPhase>('editing');
  let savedId = $state<string | null>(null);
  /** Bumped by `reset` and `dispose`, so the answer of a save or batch started before is ignored. */
  let generation = 0;
  let disposed = false;

  const session = createUploadSession({
    // The combination has no ID until it is saved; each photo goes to the saved one.
    target: { type: 'combination', id: '', title: '' },
    upload: (input) => upload({ ...input, target: { type: 'combination', id: savedId ?? '' } }),
    common,
    onSettled: ({ allDone }) => {
      if (disposed || savedId === null || (phase !== 'uploading' && phase !== 'failed')) return;
      phase = allDone ? 'done' : 'failed';
      if (allDone) onDone(savedId);
    },
    ...(convert ? { convert } : {}),
    ...(createUrl ? { createUrl } : {}),
    ...(revokeUrl ? { revokeUrl } : {}),
  });

  /** Photos not yet stored: chosen, converting, waiting, in flight or failed. */
  const unsent = () => session.items.filter((item) => item.status !== 'done').length;

  return {
    session,
    get phase() {
      return phase;
    },
    get savedId() {
      return savedId;
    },
    /** Photos chosen and not yet stored; they count as unsaved input. */
    get attached() {
      return unsent();
    },
    /** HEIC photos still turning into JPEGs: the save waits for them. */
    get converting() {
      return session.summary.converting;
    },
    /**
     * Saves the combination (`save` answers its ID, or null after a failure, which leaves the photos as they were), then
     * sends the photos. Answers false when nothing started: no photo, a conversion still running, or already under way.
     */
    async submit(save: () => Promise<string | null>): Promise<boolean> {
      if (phase !== 'editing' || session.items.length === 0 || session.summary.converting > 0) return false;
      const started = generation;
      phase = 'saving';
      const id = await save();
      if (started !== generation) {
        // The page went away during the save: the combination may be saved, its photos never went.
        if (id && disposed) onDropped();
        return true;
      }
      if (!id) {
        phase = 'editing';
        return true;
      }
      savedId = id;
      if (session.sendable === 0) {
        // Every photo was removed while the save was out.
        phase = 'done';
        onDone(id);
        return true;
      }
      phase = 'uploading';
      session.send();
      return true;
    },
    /** One failed photo again. */
    retry(key: number) {
      if (phase !== 'failed') return;
      phase = 'uploading';
      session.retry(key);
    },
    /** Every photo not stored yet, again. */
    retryAll() {
      if (phase !== 'failed' || savedId === null) return;
      if (session.sendable === 0) {
        // The writer removed every photo that failed: nothing is left to send.
        phase = 'done';
        onDone(savedId);
        return;
      }
      phase = 'uploading';
      session.send();
    },
    /** Drops the photos that did not go (Done, or the leave dialog's Discard). */
    discard() {
      session.clear();
    },
    /** An account change or sign-out: every photo and the saved state go, a late answer changes nothing. */
    reset() {
      generation++;
      session.cancel();
      session.clear();
      phase = 'editing';
      savedId = null;
    },
    /** The page unmounts: the photo in flight finishes, the rest is dropped and said so. */
    dispose() {
      const dropped = phase === 'uploading' && unsent() > 0;
      generation++;
      disposed = true;
      session.cancel();
      session.dispose();
      if (dropped) onDropped();
    },
  };
}

export type StudioPhotos = ReturnType<typeof createStudioPhotos>;
