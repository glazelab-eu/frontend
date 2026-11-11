import { describe, expect, it } from 'vitest';
import type { SyncView } from '../generated/types.gen';
import { combination, customStep, glaze, glazeStep } from '../../test/fixtures';
import { filterCombinations, glazeMap } from '../glazes/glazes';
import { applyDelta, CLIENT_FORMAT, combinationOrder, listingOf, validPoint, withGlazeNames, type DeltaOutcome, type SyncPoint } from './sync';

const point: SyncPoint = { cursor: '10.1000', epoch: 'e1', format: 1, client: CLIENT_FORMAT };

function delta(overrides: Partial<SyncView> = {}): SyncView {
  return {
    format: 1,
    cursor: '12.2000',
    epoch: 'e1',
    resync: null,
    glazes: [],
    combinations: [],
    removedGlazeIds: [],
    removedCombinationIds: [],
    visibleGlazes: 0,
    visibleCombinations: 0,
    ...overrides,
  };
}

const old = combination({ id: 'c1', publishedAt: '2026-10-01T10:00:00Z' });
const middle = combination({ id: 'c2', publishedAt: '2026-10-10T10:00:00Z' });
const newest = combination({ id: 'c3', publishedAt: '2026-10-20T10:00:00Z' });
const blue = glaze({ id: 'g1', name: 'Blue' });
const red = glaze({ id: 'g2', name: 'Red' });
const local = { glazes: [blue, red], combinations: [newest, middle, old], point };
const counts = { visibleGlazes: 2, visibleCombinations: 3 };

function applied(outcome: DeltaOutcome) {
  if (outcome.kind !== 'applied') throw new Error(`expected an applied delta, got a resync (${outcome.reason})`);
  return outcome;
}

describe('applyDelta', () => {
  it('keeps the listings and their objects for an empty answer and moves the cursor', () => {
    const outcome = applied(applyDelta(local, delta(counts)));
    expect(outcome.changed).toBe(false);
    expect(outcome.listings.glazes).toBe(local.glazes);
    expect(outcome.listings.combinations).toBe(local.combinations);
    expect(outcome.point).toEqual({ cursor: '12.2000', epoch: 'e1', format: 1, client: CLIENT_FORMAT });
  });

  it('inserts a new combination in listing order and keeps the other objects', () => {
    const added = combination({ id: 'c4', publishedAt: '2026-10-15T10:00:00Z' });
    const { listings, changed } = applied(applyDelta(local, delta({ combinations: [added], visibleGlazes: 2, visibleCombinations: 4 })));
    expect(changed).toBe(true);
    expect(listings.combinations.map((item) => item.id)).toEqual(['c3', 'c4', 'c2', 'c1']);
    expect(listings.combinations[0]).toBe(newest);
    expect(listings.glazes).toBe(local.glazes);
  });

  it('replaces an edited combination by ID in place', () => {
    const edited = { ...middle, title: 'Edited', tags: ['satin'] };
    const { listings } = applied(applyDelta(local, delta({ combinations: [edited], ...counts })));
    expect(listings.combinations.map((item) => item.id)).toEqual(['c3', 'c2', 'c1']);
    expect(listings.combinations[1]).toEqual(edited);
    expect(listings.combinations[0]).toBe(newest);
  });

  it('moves a published draft to its publication place', () => {
    const draft = combination({ id: 'c5', draft: true, createdAt: '2026-09-01T10:00:00Z', publishedAt: null });
    const start = { ...local, combinations: [newest, middle, old, draft] };
    const published = { ...draft, draft: false, publishedAt: '2026-10-25T10:00:00Z' };
    const { listings } = applied(applyDelta(start, delta({ combinations: [published], visibleGlazes: 2, visibleCombinations: 4 })));
    expect(listings.combinations.map((item) => item.id)).toEqual(['c5', 'c3', 'c2', 'c1']);
  });

  it('removes tombstoned items and ignores tombstones of items it never had', () => {
    const { listings } = applied(
      applyDelta(local, delta({ removedCombinationIds: ['c2', 'unknown'], removedGlazeIds: ['g2', 'gone'], visibleGlazes: 1, visibleCombinations: 2 })),
    );
    expect(listings.combinations.map((item) => item.id)).toEqual(['c3', 'c1']);
    expect(listings.glazes).toEqual([blue]);
  });

  it('answers the same listings when the overlap window repeats an answer it already applied', () => {
    const added = combination({ id: 'c4', publishedAt: '2026-10-15T10:00:00Z' });
    const answer = delta({ combinations: [added], removedCombinationIds: ['c1'], glazes: [red], visibleGlazes: 2, visibleCombinations: 3 });
    const once = applied(applyDelta(local, answer));
    const twice = applied(applyDelta({ ...once.listings, point: once.point }, { ...answer, combinations: [{ ...added }], glazes: [{ ...red }] }));
    expect(twice.listings.combinations).toBe(once.listings.combinations);
    expect(twice.listings.glazes).toBe(once.listings.glazes);
    expect(twice.changed).toBe(false);
  });

  it('keeps an unchanged repeat in place, even where its own order would differ', () => {
    // A listing read with the server's collation keeps its order; an equal repeat never moves.
    const start = { ...local, glazes: [red, blue] };
    const { listings, changed } = applied(applyDelta(start, delta({ glazes: [{ ...blue }], ...counts })));
    expect(changed).toBe(false);
    expect(listings.glazes).toBe(start.glazes);
  });

  it('re-sorts a renamed glaze and copies its name into the steps that use it', () => {
    const renamed = { ...blue, name: 'Zinc Blue' };
    const using = combination({ id: 'c2', publishedAt: middle.publishedAt, steps: [glazeStep({ glazeId: 'g1', name: 'Blue' }), customStep()] });
    const other = combination({ id: 'c1', publishedAt: old.publishedAt, steps: [glazeStep({ glazeId: 'g2', name: 'Red' })] });
    const start = { ...local, combinations: [newest, using, other] };
    const { listings } = applied(applyDelta(start, delta({ glazes: [renamed], ...counts })));
    expect(listings.glazes.map((item) => item.name)).toEqual(['Red', 'Zinc Blue']);
    expect(listings.combinations[1].steps.map((step) => step.name)).toEqual(['Zinc Blue', null]);
    expect(listings.combinations[1].steps[1]).toBe(using.steps[1]);
    expect(listings.combinations[2]).toBe(other);
    expect(listings.combinations[0]).toBe(newest);
  });

  it('lets search find a combination by the corrected glaze name, even without the glaze in the map', () => {
    const using = combination({
      id: 'c2',
      title: 'Tile',
      publishedAt: middle.publishedAt,
      steps: [glazeStep({ glazeId: 'g1', manufacturer: 'Amaco', name: 'Blue' })],
    });
    const start = { ...local, combinations: [newest, using, old] };
    const renamed = { ...blue, name: 'Celadon' };
    const { listings } = applied(applyDelta(start, delta({ glazes: [renamed], ...counts })));
    expect(filterCombinations(listings.combinations, 'celadon', new Map()).map((item) => item.id)).toEqual(['c2']);
    expect(filterCombinations(listings.combinations, 'celadon', glazeMap(listings.glazes)).map((item) => item.id)).toEqual(['c2']);
    expect(filterCombinations(listings.combinations, 'blue', new Map()).map((item) => item.id)).not.toContain('c2');
  });

  it.each(['CURSOR', 'FORMAT', 'EPOCH', 'EXPIRED', 'TOO_MANY'] as const)('asks for a full load from the answer itself after resync %s', (reason) => {
    const outcome = applyDelta(local, delta({ resync: reason, cursor: '20.3000', epoch: 'e2', format: 1, visibleCombinations: 5000 }));
    expect(outcome).toEqual({ kind: 'resync', reason, start: { cursor: '20.3000', epoch: 'e2', format: 1, client: CLIENT_FORMAT } });
  });

  it('asks for a full load when the counts after applying differ from the server listing', () => {
    expect(applyDelta(local, delta({ visibleGlazes: 2, visibleCombinations: 4 }))).toMatchObject({
      kind: 'resync',
      reason: 'COUNTS',
      start: { cursor: '12.2000' },
    });
    expect(applyDelta(local, delta({ visibleGlazes: 3, visibleCombinations: 3 }))).toMatchObject({ kind: 'resync', reason: 'COUNTS' });
  });

  it('asks for a full load for a format or epoch other than the stored one, even without a resync reason', () => {
    expect(applyDelta(local, delta({ format: 2, ...counts }))).toMatchObject({ kind: 'resync', reason: 'FORMAT', start: { format: 2 } });
    expect(applyDelta(local, delta({ epoch: 'e2', ...counts }))).toMatchObject({ kind: 'resync', reason: 'EPOCH', start: { epoch: 'e2' } });
  });

  it('applies a visibility change that rotates a photo ID as a replacement of its combination', () => {
    const before = combination({ id: 'c2', publishedAt: middle.publishedAt, images: [{ ...imageOf('i1'), visibility: 'PUBLIC' }] });
    const after = { ...before, images: [{ ...imageOf('i9'), visibility: 'CLUB' as const, clubId: 'k1' }] };
    const start = { ...local, combinations: [newest, before, old] };
    const { listings } = applied(applyDelta(start, delta({ combinations: [after], ...counts })));
    expect(listings.combinations[1].images.map((image) => image.id)).toEqual(['i9']);
  });
});

function imageOf(id: string) {
  return {
    id,
    visibility: 'PUBLIC' as const,
    kind: 'TEST_TILE' as const,
    url: `/api/images/${id}`,
    cardUrl: `/api/images/${id}/card`,
    width: 1,
    height: 1,
    clubId: null,
    own: false,
    uploader: null,
    canDelete: false,
    caption: null,
    firedOn: null,
    focusX: null,
    focusY: null,
  };
}

describe('withGlazeNames', () => {
  it('answers the same list when no step needs a new name', () => {
    const list = [combination({ steps: [glazeStep({ glazeId: 'g1', manufacturer: 'Amaco', name: 'Blue' })] })];
    expect(withGlazeNames(list, [blue])).toBe(list);
    expect(withGlazeNames(list, [])).toBe(list);
  });

  it('copies the manufacturer too and never touches custom steps', () => {
    const list = [combination({ steps: [glazeStep({ glazeId: 'g1', manufacturer: 'Old', name: 'Blue' }), customStep({ label: 'g1' })] })];
    const [renamed] = withGlazeNames(list, [blue]);
    expect(renamed.steps[0]).toMatchObject({ manufacturer: 'Amaco', name: 'Blue' });
    expect(renamed.steps[1]).toBe(list[0].steps[1]);
  });
});

describe('listing order', () => {
  it('sorts a paged listing newest first by publication, a draft by creation, then by ID', () => {
    const draft = combination({ id: 'c0', draft: true, createdAt: '2026-10-12T10:00:00Z' });
    const twin = combination({ id: 'c9', publishedAt: middle.publishedAt });
    expect(listingOf([old, twin, draft, middle, newest]).map((item) => item.id)).toEqual(['c3', 'c0', 'c2', 'c9', 'c1']);
    expect(combinationOrder(middle, twin)).toBeLessThan(0);
  });
});

describe('validPoint', () => {
  it('keeps a complete point of this client layout', () => {
    expect(validPoint(point)).toEqual(point);
  });

  it.each([
    ['nothing', undefined],
    ['no cursor', { ...point, cursor: '' }],
    ['no epoch', { ...point, epoch: undefined }],
    ['no format', { ...point, format: undefined }],
    ['another client layout', { ...point, client: CLIENT_FORMAT + 1 }],
    ['the layout before pictures carried their uploader (24-10: loads in full to name them)', { ...point, client: 1 }],
    ['no client layout', { cursor: 'x', epoch: 'e', format: 1 }],
  ])('drops %s', (_, saved) => {
    expect(validPoint(saved)).toBeNull();
  });
});
