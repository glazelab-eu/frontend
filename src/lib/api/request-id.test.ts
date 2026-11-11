import { afterEach, describe, expect, it, vi } from 'vitest';
import { newRequestId } from './request-id';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newRequestId', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('answers a fresh version 4 UUID each time', () => {
    const ids = new Set(Array.from({ length: 50 }, newRequestId));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(UUID_V4);
  });

  it('builds one from random bytes outside a secure context', () => {
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => bytes.fill(0xff) });
    expect(newRequestId()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
  });
});
