import { describe, expect, it } from 'vitest';
import { hasArrays, isAccount, isImageType, isJsonType, isSyncAnswer } from './answers';

describe('answer checks', () => {
  it('accepts only JSON media types as data', () => {
    for (const type of ['application/json', 'application/json;charset=UTF-8', 'application/problem+json', ' Application/JSON '])
      expect(isJsonType(type)).toBe(true);
    for (const type of ['application/octet-stream', 'text/html', 'text/plain', 'application/jsonp', 'image/jpeg', '']) expect(isJsonType(type)).toBe(false);
  });

  it('accepts only image media types as pictures', () => {
    expect(isImageType('image/jpeg')).toBe(true);
    for (const type of ['application/octet-stream', 'text/html', '']) expect(isImageType(type)).toBe(false);
  });

  it('accepts an account only with a non-empty string ID', () => {
    expect(isAccount({ id: 'u1', email: 'a@example.test' })).toBe(true);
    for (const value of [null, {}, [], 'u1', { id: '' }, { id: 7 }, new Blob(['x'])]) expect(isAccount(value)).toBe(false);
  });

  it('checks the outer shape of listings and sync answers', () => {
    expect(hasArrays('glazeIds', 'combinationIds')({ glazeIds: [], combinationIds: [] })).toBe(true);
    expect(hasArrays('glazeIds', 'combinationIds')({ glazeIds: [] })).toBe(false);
    const sync = { glazes: [], combinations: [], removedGlazeIds: [], removedCombinationIds: [], cursor: '1', epoch: 'e' };
    expect(isSyncAnswer(sync)).toBe(true);
    expect(isSyncAnswer({ ...sync, cursor: undefined })).toBe(false);
    expect(isSyncAnswer([])).toBe(false);
  });
});
