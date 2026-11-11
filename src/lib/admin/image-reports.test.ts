import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appendPage } from '../paging/paging';
import {
  REPORT_PAGE_SIZE,
  adminVisibilityKey,
  deletionItem,
  formatServerTime,
  nextReportPage,
  reportIdOf,
  reportPhotoUrl,
  reportTarget,
  withoutPhoto,
  withoutReport,
} from './image-reports';

const report = (id: string, imageId = `i-${id}`) => ({ id, imageId });

describe('reportTarget', () => {
  it('opens the glaze or the combination of the reported photo, at that photo', () => {
    expect(reportTarget({ glazeId: 'g1', combinationId: null, imageId: 'i1' })).toEqual({
      name: 'glaze',
      id: 'g1',
      photo: 'i1',
    });
    expect(reportTarget({ glazeId: null, combinationId: 'c1', imageId: 'i2' })).toEqual({
      name: 'combination',
      id: 'c1',
      photo: 'i2',
    });
  });

  it('falls back to not found without a target', () => {
    expect(reportTarget({ glazeId: null, combinationId: null, imageId: 'i1' })).toEqual({ name: 'not-found' });
  });
});

describe('reportPhotoUrl', () => {
  it('gives only a public photo a thumbnail address (Q11: never a hidden photo)', () => {
    expect(reportPhotoUrl({ imageId: 'i1', visibility: 'PUBLIC' })).toBe('/api/images/i1/card');
    expect(reportPhotoUrl({ imageId: 'i1', visibility: 'CLUB' })).toBeNull();
    expect(reportPhotoUrl({ imageId: 'i1', visibility: 'PRIVATE' })).toBeNull();
  });
});

describe('adminVisibilityKey', () => {
  it('names each visibility for an admin; an unknown one counts as private', () => {
    expect(adminVisibilityKey('PUBLIC')).toBe('images.log.public');
    expect(adminVisibilityKey('CLUB')).toBe('images.log.club');
    expect(adminVisibilityKey('PRIVATE')).toBe('images.log.private');
    expect(adminVisibilityKey('SOMETHING')).toBe('images.log.private');
  });
});

describe('deletionItem', () => {
  it('names the glaze or the combination, and nothing when the log kept neither', () => {
    expect(deletionItem({ glazeId: 'g1', combinationId: null })).toEqual({ label: 'images.log.glaze', id: 'g1' });
    expect(deletionItem({ glazeId: null, combinationId: 'c1' })).toEqual({ label: 'images.log.combination', id: 'c1' });
    expect(deletionItem({ glazeId: null, combinationId: null })).toBeNull();
  });
});

describe('formatServerTime', () => {
  const instant = '2026-10-30T14:05:09.123Z';

  it("writes date and time in UTC, in the reader's language", () => {
    expect(formatServerTime(instant, 'en')).toBe('30 Oct 2026, 14:05 UTC');
    expect(formatServerTime(instant, 'de')).toMatch(/^30\.\s?Okt\.? 2026,? 14:05 UTC$/);
    expect(formatServerTime(instant, 'pt-PT')).toMatch(/^30\/10\/2026,? 14:05 UTC$|^30 de out\. de 2026,? 14:05 UTC$/);
  });

  it('keeps a value that is no date as it came', () => {
    expect(formatServerTime('not a time', 'en')).toBe('not a time');
  });
});

describe('queue updates', () => {
  const rows = [report('r1', 'a'), report('r2', 'b'), report('r3', 'a')];

  it.each([
    ['dismissing removes only that report', (list: typeof rows, id: string) => withoutReport(list, id), 'r1', ['r2', 'r3']],
    ['deleting a photo removes every report of it', (list: typeof rows, id: string) => withoutPhoto(list, id), 'a', ['r2']],
  ])('%s', (_case, update, id, left) => {
    expect(update(rows, id).map(reportIdOf)).toEqual(left);
  });
});

describe('nextReportPage', () => {
  // A newest-first queue like GET /api/admin/image-reports.
  const serve = (queue: { id: string; imageId: string }[], page: number) => ({
    entries: queue.slice(page * REPORT_PAGE_SIZE, (page + 1) * REPORT_PAGE_SIZE),
    hasMore: queue.length > (page + 1) * REPORT_PAGE_SIZE,
  });

  it('asks for the following page while nothing was removed', () => {
    expect(nextReportPage(0)).toBe(0);
    expect(nextReportPage(50)).toBe(1);
    expect(nextReportPage(100)).toBe(2);
  });

  it('reaches every report once after removals shifted the server pages', () => {
    let queue = Array.from({ length: 120 }, (_, i) => report(`r${i}`));
    let rows = appendPage([], serve(queue, 0).entries, reportIdOf);
    for (const id of ['r3', 'r10', 'r49']) {
      queue = withoutReport(queue, id);
      rows = withoutReport(rows, id);
    }
    let hasMore = true;
    while (hasMore) {
      const page = serve(queue, nextReportPage(rows.length));
      rows = appendPage(rows, page.entries, reportIdOf);
      hasMore = page.hasMore;
    }
    expect(rows.map(reportIdOf)).toEqual(queue.map(reportIdOf));
  });
});

describe('formatServerTime in a reader’s zone far from UTC', () => {
  const zone = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = 'America/Los_Angeles';
  });
  afterAll(() => {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  });

  it('shows the instant in UTC, so the UTC label is true', () => {
    expect(formatServerTime('2026-11-10T07:00:00Z', 'en')).toBe('10 Nov 2026, 07:00 UTC');
    expect(formatServerTime('2026-11-10T07:00:00.568119Z', 'en')).toBe('10 Nov 2026, 07:00 UTC');
  });

  it('never reads a zone-less time in the reader’s zone', () => {
    expect(formatServerTime('2026-11-10T07:00:00', 'en')).toBe('10 Nov 2026, 07:00 UTC');
  });
});
