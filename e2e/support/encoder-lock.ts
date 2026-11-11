import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { OUTPUT } from './paths';

/** Created by one worker at a time (mkdir is atomic); global setup removes a leftover of an aborted run. */
export const ENCODER_LOCK = join(OUTPUT, 'encoder.lock');

/**
 * The API encodes one image at a time and answers 503 to a second upload meanwhile, so every upload of the suite (API seeding
 * and upload dialogs) runs under this lock across workers.
 */
export async function withEncoder<T>(work: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      await mkdir(ENCODER_LOCK);
      break;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST') || Date.now() > deadline) throw error;
      await delay(25);
    }
  }
  try {
    return await work();
  } finally {
    await rm(ENCODER_LOCK, { recursive: true, force: true });
  }
}
