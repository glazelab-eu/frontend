import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { instantTime } from './instant';

describe('instantTime', () => {
  // Node applies a changed TZ at once: the reader is far from UTC, so local parsing would shift every value.
  const zone = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = 'America/Los_Angeles';
  });
  afterAll(() => {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  });

  it('reads an instant with Z or an offset', () => {
    expect(new Date(2026, 10, 10).getTimezoneOffset()).toBe(480);
    expect(instantTime('2026-11-10T07:00:00Z')).toBe(Date.UTC(2026, 10, 10, 7));
    expect(instantTime('2026-11-10T07:00:00.123456Z')).toBe(Date.UTC(2026, 10, 10, 7, 0, 0, 123));
    expect(instantTime('2026-11-10T08:00:00+01:00')).toBe(Date.UTC(2026, 10, 10, 7));
  });

  it("reads an older saved zone-less time as UTC, never in the reader's zone", () => {
    expect(instantTime('2026-11-10T07:00:00')).toBe(Date.UTC(2026, 10, 10, 7));
    expect(instantTime('2026-11-10T07:00:00.568119')).toBe(Date.UTC(2026, 10, 10, 7, 0, 0, 568));
  });

  it('answers null for anything that is no date and time', () => {
    for (const text of [null, undefined, '', 'not a time', '2026-11-10', '2026-13-40T99:00:00Z']) expect(instantTime(text)).toBeNull();
  });
});
