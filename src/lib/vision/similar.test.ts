import { describe, expect, it } from 'vitest';
import { combination, glaze, imageInfo } from '../../test/fixtures';
import { VectorIndex } from './embeddings';
import { pauseReason, pendingPhotos, staleIds, LOW_BATTERY, type Conditions } from './indexing';
import { itemKey, libraryPhotos } from './library';
import { rankSimilar } from './similar';

const photo = (id: string, kind: 'TEST_TILE' | 'FINISHED' | 'PACKAGING' | 'IN_PROGRESS') =>
  imageInfo({ id, kind, url: `/api/images/${id}`, cardUrl: `/api/images/${id}/card` });

describe('libraryPhotos', () => {
  it('lists test tiles and finished pieces with their item, never packaging, once per image', () => {
    const photos = libraryPhotos(
      [glaze({ id: 'g1', name: 'Blue', images: [photo('a', 'TEST_TILE'), photo('p', 'PACKAGING')] })],
      [combination({ id: 'c1', title: 'Duo', images: [photo('b', 'FINISHED'), photo('a', 'FINISHED')] })],
    );
    expect([...photos.keys()]).toEqual(['a', 'b']);
    expect(photos.get('a')).toMatchObject({ kind: 'TEST_TILE', type: 'glaze', itemId: 'g1' });
    expect(photos.get('b')).toMatchObject({ kind: 'FINISHED', type: 'combination', itemId: 'c1', title: 'Duo' });
  });
});

describe('work in progress', () => {
  const photos = libraryPhotos(
    [glaze({ id: 'g1', images: [photo('g1-tile', 'TEST_TILE')] })],
    [
      combination({ id: 'c1', images: [photo('c1-progress', 'IN_PROGRESS')] }),
      combination({ id: 'c2', images: [photo('c2-progress', 'IN_PROGRESS'), photo('c2-finished', 'FINISHED')] }),
      combination({ id: 'c3', images: [photo('c3-finished', 'FINISHED')] }),
    ],
  );
  const index = new VectorIndex(2);
  // Every photo has the same look: only the kind keeps them apart.
  for (const id of photos.keys()) index.add(id, [1, 0]);
  const ids = (hits: ReturnType<typeof rankSimilar>) => hits.map((hit) => hit.photo.id).sort();

  it('is indexed as its own kind', () => {
    expect(photos.get('c1-progress')).toMatchObject({ kind: 'IN_PROGRESS', type: 'combination', itemId: 'c1' });
  });

  it('is compared only with work in progress, never with finished pieces or test tiles, and they never answer with it', () => {
    expect(ids(rankSimilar(index, [{ vector: [1, 0], kind: 'IN_PROGRESS' }], photos, { exclude: 'combination:c1', limit: 6 }))).toEqual(['c2-progress']);
    expect(ids(rankSimilar(index, [{ vector: [1, 0], kind: 'FINISHED' }], photos, { limit: 6 }))).toEqual(['c2-finished', 'c3-finished']);
    expect(ids(rankSimilar(index, [{ vector: [1, 0], kind: 'TEST_TILE' }], photos, { limit: 6 }))).toEqual(['g1-tile']);
  });
});

describe('rankSimilar', () => {
  const photos = libraryPhotos(
    [
      glaze({ id: 'g1', images: [photo('g1-tile', 'TEST_TILE')] }),
      glaze({ id: 'g2', images: [photo('g2-tile', 'TEST_TILE'), photo('g2-tile-2', 'TEST_TILE')] }),
    ],
    [
      combination({ id: 'c1', images: [photo('c1-finished', 'FINISHED'), photo('c1-tile', 'TEST_TILE')] }),
      combination({ id: 'c2', images: [photo('c2-finished', 'FINISHED')] }),
    ],
  );
  const index = new VectorIndex(2);
  index.add('g1-tile', [1, 0]);
  index.add('g2-tile', [0.9, 0.1]);
  index.add('g2-tile-2', [0.95, 0.05]);
  index.add('c1-tile', [0.8, 0.2]);
  // A finished piece of the same colour as the tiles: it must never answer a test tile.
  index.add('c1-finished', [1, 0]);
  index.add('c2-finished', [0.7, 0.3]);

  it('compares a test tile only with test tiles and a finished piece only with finished pieces', () => {
    const tiles = rankSimilar(index, [{ vector: [1, 0], kind: 'TEST_TILE' }], photos, { limit: 10 });
    expect(tiles.map((hit) => hit.photo.id)).toEqual(['g1-tile', 'g2-tile-2', 'c1-tile']);
    const finished = rankSimilar(index, [{ vector: [1, 0], kind: 'FINISHED' }], photos, { limit: 10 });
    expect(finished.map((hit) => hit.photo.id)).toEqual(['c1-finished', 'c2-finished']);
  });

  it('answers each item once with its best photo and leaves out the item itself', () => {
    const hits = rankSimilar(index, [{ vector: [1, 0], kind: 'TEST_TILE' }], photos, { limit: 10, exclude: itemKey('glaze', 'g1') });
    expect(hits.map((hit) => [hit.photo.itemId, hit.photo.id])).toEqual([
      ['g2', 'g2-tile-2'],
      ['c1', 'c1-tile'],
    ]);
  });

  it('takes the best score over several query photos and honours the limit', () => {
    const hits = rankSimilar(
      index,
      [
        { vector: [0, 1], kind: 'TEST_TILE' },
        { vector: [1, 0], kind: 'TEST_TILE' },
      ],
      photos,
      { limit: 2 },
    );
    expect(hits).toHaveLength(2);
    expect(hits[0].photo.id).toBe('g1-tile');
    expect(hits[0].score).toBeCloseTo(1, 6);
  });

  it('answers only photos the library still lists', () => {
    const withGhost = new VectorIndex(2);
    withGhost.add('ghost', [1, 0]);
    withGhost.add('g1-tile', [0.5, 0.5]);
    expect(rankSimilar(withGhost, [{ vector: [1, 0], kind: 'TEST_TILE' }], photos, { limit: 5 }).map((hit) => hit.photo.id)).toEqual(['g1-tile']);
  });

  it('reads the kind from the listings, so a photo whose kind was edited changes sides', () => {
    const edited = libraryPhotos([glaze({ id: 'g1', images: [photo('g1-tile', 'FINISHED')] })], []);
    expect(rankSimilar(index, [{ vector: [1, 0], kind: 'TEST_TILE' }], edited, { limit: 5 })).toEqual([]);
    expect(rankSimilar(index, [{ vector: [1, 0], kind: 'FINISHED' }], edited, { limit: 5 }).map((hit) => hit.photo.id)).toEqual(['g1-tile']);
  });
});

describe('indexing rules', () => {
  const calm: Conditions = { online: true, hidden: false, battery: null, metered: false, meteredAllowed: false };

  it('runs when nothing is against it, also where the browser does not say the battery', () => {
    expect(pauseReason(calm)).toBeNull();
    expect(pauseReason({ ...calm, battery: { charging: false, level: 0.5 } })).toBeNull();
  });

  it('waits offline, in a hidden tab, on a low battery that is not charging and on a metered connection nobody agreed to', () => {
    expect(pauseReason({ ...calm, online: false })).toBe('offline');
    expect(pauseReason({ ...calm, hidden: true })).toBe('hidden');
    expect(pauseReason({ ...calm, battery: { charging: false, level: LOW_BATTERY - 0.01 } })).toBe('battery');
    expect(pauseReason({ ...calm, metered: true })).toBe('metered');
  });

  it('does not wait for a low battery that is charging, at exactly the limit, or a metered connection that was agreed to', () => {
    expect(pauseReason({ ...calm, battery: { charging: true, level: 0.01 } })).toBeNull();
    expect(pauseReason({ ...calm, battery: { charging: false, level: LOW_BATTERY } })).toBeNull();
    expect(pauseReason({ ...calm, metered: true, meteredAllowed: true })).toBeNull();
  });

  it('names the first reason when several apply: no connection, then the hidden tab, then the battery, then the metered line', () => {
    const all = { online: false, hidden: true, battery: { charging: false, level: 0.01 }, metered: true, meteredAllowed: false };
    expect(pauseReason(all)).toBe('offline');
    expect(pauseReason({ ...all, online: true })).toBe('hidden');
    expect(pauseReason({ ...all, online: true, hidden: false })).toBe('battery');
  });

  it('lists the photos still to embed in listing order, without the stored and the skipped', () => {
    const photos = libraryPhotos(
      [glaze({ id: 'g', images: [photo('a', 'TEST_TILE'), photo('b', 'TEST_TILE'), photo('c', 'TEST_TILE'), photo('d', 'FINISHED')] })],
      [],
    );
    expect(pendingPhotos(photos, (id) => id === 'a', new Set(['c'])).map((item) => item.id)).toEqual(['b', 'd']);
  });

  it('names the stored vectors whose photo the listings no longer show', () => {
    const photos = libraryPhotos([glaze({ id: 'g', images: [photo('a', 'TEST_TILE')] })], []);
    expect(staleIds(['a', 'gone', 'moved'], photos)).toEqual(['gone', 'moved']);
  });
});
