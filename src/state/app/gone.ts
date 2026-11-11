import { ApiError } from '../../lib/api/client';

/** Answer of `ifGone` when the server no longer knows the photo or glaze. */
export const GONE = Symbol('gone');

/** Runs a photo or glaze request; a 404 (someone removed it meanwhile) answers `GONE` instead of failing. */
export async function ifGone<R>(request: () => Promise<R>): Promise<R | typeof GONE> {
  try {
    return await request();
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return GONE;
    throw error;
  }
}
