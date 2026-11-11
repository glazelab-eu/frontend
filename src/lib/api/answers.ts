/**
 * Checks of the API's 2xx answers before anything applies or saves them. A proxy's or captive portal's page and the API's tarpit
 * decoy answer 200 too: such an answer is a failed request (`client.ts` turns it into an unreachable `ApiError`), never data,
 * never "not signed in". Only the outer shape is checked (an object with its arrays, or an array); the generated types do the rest.
 */

/** A JSON media type (`application/json`, `application/problem+json`, with or without parameters). */
export const isJsonType = (type: string) => /^application\/([\w.-]+\+)?json\s*(;|$)/i.test(type.trim());

/** A picture's media type: the only answer a picture download may save or show. */
export const isImageType = (type: string) => /^image\//i.test(type.trim());

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The signed-in account (`GET /api/auth/me`): an object with a non-empty string ID. */
export const isAccount = (value: unknown) => isObject(value) && typeof value.id === 'string' && value.id !== '';

/** An object whose `keys` are all arrays. */
export const hasArrays =
  (...keys: string[]) =>
  (value: unknown) =>
    isObject(value) && keys.every((key) => Array.isArray(value[key]));

export const isList = (value: unknown) => Array.isArray(value);

/** A sync answer: the changed and removed items, and a cursor and epoch to continue from. */
export const isSyncAnswer = (value: unknown) =>
  hasArrays('glazes', 'combinations', 'removedGlazeIds', 'removedCombinationIds')(value) &&
  typeof (value as Record<string, unknown>).cursor === 'string' &&
  typeof (value as Record<string, unknown>).epoch === 'string';
