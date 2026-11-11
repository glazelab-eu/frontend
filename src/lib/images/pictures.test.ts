import { describe, expect, it } from 'vitest';
import type { ImageInfo } from '../api/models';
import { combination, glaze, glazeStep, imageInfo } from '../../test/fixtures';
import {
  pictureSrc,
  combinationPictures,
  finishedPiecesByGlaze,
  glazePictures,
  glazeGallery,
  hasResultPhoto,
  imageKindKey,
  IMAGE_KINDS,
  kindsOn,
  orderByFiring,
  orderPhotos,
  glazeThumbnail,
  glazeTestTile,
  pictureDescription,
  removalDescription,
  selectPictures,
  stageShape,
  visibilityChange,
  viewerSlides,
  viewerStart,
  visibilityChoice,
} from './pictures';

const image = (id: string, kind: ImageInfo['kind']) => imageInfo({ id, kind });
const glazeOf = (id: string, images: ImageInfo[] = []) => glaze({ id, name: `Glaze ${id}`, images });
const combinationOf = (id: string, glazeIds: string[], images: ImageInfo[]) =>
  combination({
    id,
    title: `Combination ${id}`,
    images,
    steps: glazeIds.map((glazeId, index) => glazeStep({ glazeId, position: index + 1, name: glazeId })),
  });
const ids = (pictures: { image: ImageInfo }[]) => pictures.map((picture) => picture.image.id);

describe('selectPictures', () => {
  it('uses the first test tile as the cover and finished pieces first among thumbnails', () => {
    const selection = selectPictures(
      [image('finished-1', 'FINISHED'), image('tile-1', 'TEST_TILE'), image('tile-2', 'TEST_TILE'), image('finished-2', 'FINISHED')].map((item) => ({
        image: item,
      })),
    );
    expect(selection.cover?.image.id).toBe('tile-1');
    expect(ids(selection.thumbnails)).toEqual(['finished-1', 'finished-2', 'tile-2']);
  });

  it('falls back to a finished piece and limits thumbnails', () => {
    const pictures = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ image: image(id, 'FINISHED') }));
    const selection = selectPictures(pictures);
    expect(selection.cover?.image.id).toBe('a');
    expect(ids(selection.thumbnails)).toEqual(['b', 'c', 'd']);
    expect(selectPictures(pictures, 1).thumbnails).toHaveLength(1);
  });

  it('keeps finished pieces visible even with many test tiles', () => {
    const tiles = ['t1', 't2', 't3', 't4'].map((id) => ({ image: image(id, 'TEST_TILE') }));
    const selection = selectPictures([...tiles, { image: image('f1', 'FINISHED') }]);
    expect(ids(selection.thumbnails)).toEqual(['f1', 't2', 't3']);
  });

  it('returns no cover without pictures', () => {
    expect(selectPictures([])).toEqual({ cover: null, thumbnails: [] });
  });
});

describe('orderPhotos', () => {
  const of = (id: string, kind: string) => ({ image: { id, kind } });
  const order = (pictures: { image: { id: string } }[]) => pictures.map((picture) => picture.image.id);

  it('ranks finished pieces, then test tiles, then work in progress, then packaging', () => {
    const pictures = [of('p', 'PACKAGING'), of('w', 'IN_PROGRESS'), of('t', 'TEST_TILE'), of('f', 'FINISHED')];
    expect(order(orderPhotos(pictures))).toEqual(['f', 't', 'w', 'p']);
  });

  it('keeps the order within a kind and does not change its input', () => {
    const pictures = [of('t1', 'TEST_TILE'), of('f1', 'FINISHED'), of('t2', 'TEST_TILE'), of('f2', 'FINISHED'), of('t3', 'TEST_TILE')];
    expect(order(orderPhotos(pictures))).toEqual(['f1', 'f2', 't1', 't2', 't3']);
    expect(order(pictures)).toEqual(['t1', 'f1', 't2', 'f2', 't3']);
  });

  it('sorts an unknown kind last, in its order', () => {
    const pictures = [of('u1', 'SKETCH'), of('p', 'PACKAGING'), of('u2', 'OTHER'), of('f', 'FINISHED')];
    expect(order(orderPhotos(pictures))).toEqual(['f', 'p', 'u1', 'u2']);
  });

  it('handles empty and single lists', () => {
    expect(orderPhotos([])).toEqual([]);
    expect(order(orderPhotos([of('t', 'TEST_TILE')]))).toEqual(['t']);
  });
});

describe('combination and glaze pictures', () => {
  it('puts a combination finished piece before its test tile, whichever was uploaded first', () => {
    // The API lists the newest upload first: the tile was uploaded before the piece, then the other way round.
    for (const images of [
      [image('f', 'FINISHED'), image('t', 'TEST_TILE')],
      [image('t', 'TEST_TILE'), image('f', 'FINISHED')],
    ]) {
      const selection = combinationPictures(combinationOf('c', ['g'], images));
      expect(selection.cover?.image.id).toBe('f');
      expect(ids(selection.thumbnails)).toEqual(['t']);
    }
  });

  it('keeps a combination with only test tiles in upload order', () => {
    const selection = combinationPictures(combinationOf('c', ['g'], [image('t1', 'TEST_TILE'), image('t2', 'TEST_TILE')]));
    expect(selection.cover?.image.id).toBe('t1');
    expect(ids(selection.thumbnails)).toEqual(['t2']);
  });

  it('does not index a combination by its custom steps', () => {
    const fired = combinationOf('c', ['g1'], [image('f', 'FINISHED')]);
    fired.steps.push({
      ...fired.steps[0],
      position: 2,
      type: 'CUSTOM',
      glazeId: null,
      label: 'Bisque firing',
    });
    expect([...finishedPiecesByGlaze([fired]).keys()]).toEqual(['g1']);
  });

  it('indexes only finished pieces by every glaze used, once per combination', () => {
    const related = finishedPiecesByGlaze([
      { ...combinationOf('c1', ['g1', 'g2', 'g1'], [image('tile', 'TEST_TILE'), image('f1', 'FINISHED')]), authorId: 'ana' },
      combinationOf('c2', ['g1'], [image('f2', 'FINISHED')]),
      combinationOf('c3', ['g3'], [image('tile-only', 'TEST_TILE')]),
    ]);
    expect(ids(related.get('g1') ?? [])).toEqual(['f1', 'f2']);
    expect(ids(related.get('g2') ?? [])).toEqual(['f1']);
    // The author decides which visibilities a borrowed photo may take (`photoAudience`).
    expect(related.get('g2')?.[0].combination).toEqual({ id: 'c1', title: 'Combination c1', authorId: 'ana' });
    expect(related.has('g3')).toBe(false);
  });

  it("shows a glaze's own test tile first, then its own and related finished pieces", () => {
    const related = finishedPiecesByGlaze([combinationOf('c1', ['g'], [image('f-combo', 'FINISHED')])]);
    const selection = glazePictures(glazeOf('g', [image('f-own', 'FINISHED'), image('t-own', 'TEST_TILE')]), related.get('g'));
    expect(selection.cover?.image.id).toBe('t-own');
    expect(ids(selection.thumbnails)).toEqual(['f-own', 'f-combo']);
  });

  it('uses a finished piece from a combination when the glaze has no pictures', () => {
    const related = finishedPiecesByGlaze([combinationOf('c1', ['g'], [image('f-combo', 'FINISHED')])]);
    const selection = glazePictures(glazeOf('g'), related.get('g'));
    expect(selection.cover?.combination?.id).toBe('c1');
    expect(glazePictures(glazeOf('other')).cover).toBeNull();
  });

  it('exposes every picture on detail pages while keeping catalog previews short', () => {
    const images = Array.from({ length: 20 }, (_, i) => image(`f${i}`, 'FINISHED'));
    images.push(image('tile', 'TEST_TILE'));
    const combo = combinationOf('c', ['g'], images);
    expect(combinationPictures(combo).thumbnails).toHaveLength(3);
    const all = combinationPictures(combo, Infinity);
    expect(all.cover?.image.id).toBe('f0');
    expect(ids(all.thumbnails)).toEqual([...images.slice(1, 20).map((item) => item.id), 'tile']);
    const related = finishedPiecesByGlaze([combo]).get('g');
    const selection = glazePictures(glazeOf('g', [image('own', 'TEST_TILE')]), related, Infinity);
    expect(selection.cover?.image.id).toBe('own');
    expect(selection.thumbnails).toHaveLength(20);
    expect(selection.thumbnails.every((picture) => picture.combination?.id === 'c')).toBe(true);
    expect(glazePictures(glazeOf('g'), related).thumbnails).toHaveLength(3);
  });

  it('describes pictures by kind and source', () => {
    expect(pictureDescription({ image: image('t', 'TEST_TILE') }, 'Blue')).toEqual({
      key: 'images.alt.tile',
      title: 'Blue',
    });
    expect(pictureDescription({ image: image('f', 'FINISHED'), combination: { id: 'c', title: 'Layers', authorId: null } }, 'Blue')).toEqual({
      key: 'images.alt.finished',
      title: 'Layers',
    });
  });

  it('names the source of a photo being removed even on another item’s card', () => {
    const tile = image('t', 'TEST_TILE');
    const piece = image('f', 'FINISHED');
    const glazes = [glazeOf('g', [tile])];
    const combinations = [combinationOf('c', ['g'], [piece])];
    expect(removalDescription(tile, glazes, combinations)).toEqual({
      key: 'images.alt.tile',
      title: 'Amaco PC-20 Glaze g',
    });
    expect(removalDescription(piece, glazes, combinations)).toEqual({
      key: 'images.alt.finished',
      title: 'Combination c',
    });
    expect(removalDescription(piece, [], [])).toEqual({ key: 'images.alt.finished', title: 'f' });
  });
});

describe('glazeTestTile', () => {
  it('picks the newest own test tile and ignores finished pieces', () => {
    const tiles = glazeOf('g', [image('f', 'FINISHED'), image('t1', 'TEST_TILE'), image('t2', 'TEST_TILE')]);
    expect(glazeTestTile(tiles)?.image.id).toBe('t1');
    expect(glazeTestTile(glazeOf('g', [image('f', 'FINISHED')]))).toBeNull();
    expect(glazeTestTile(undefined)).toBeNull();
  });
});

describe('glazeThumbnail', () => {
  it('prefers the newest test tile, else the newest own photo, else nothing', () => {
    const both = glazeOf('g', [image('f', 'FINISHED'), image('t', 'TEST_TILE')]);
    expect(glazeThumbnail(both)?.image.id).toBe('t');
    expect(glazeThumbnail(glazeOf('g', [image('f', 'FINISHED')]))?.image.id).toBe('f');
    expect(glazeThumbnail(glazeOf('g'))).toBeNull();
    expect(glazeThumbnail(undefined)).toBeNull();
  });
});

describe('visibility choices', () => {
  it('round-trips public, private and club choices', () => {
    expect(visibilityChoice({ visibility: 'PUBLIC', clubId: null })).toBe('PUBLIC');
    expect(visibilityChoice({ visibility: 'PRIVATE', clubId: null })).toBe('PRIVATE');
    expect(visibilityChoice({ visibility: 'CLUB', clubId: 'k1' })).toBe('CLUB:k1');
    expect(visibilityChange('PUBLIC')).toEqual({ visibility: 'PUBLIC' });
    expect(visibilityChange('PRIVATE')).toEqual({ visibility: 'PRIVATE' });
    expect(visibilityChange('CLUB:k1')).toEqual({ visibility: 'CLUB', clubId: 'k1' });
  });
});

describe('packaging photos', () => {
  it('never offers packaging as a result cover, thumbnail or compact shelf/list preview', () => {
    const jar = image('jar', 'PACKAGING'),
      tile = image('tile', 'TEST_TILE'),
      piece = image('piece', 'FINISHED');
    const onlyJar = glazeOf('g', [jar]);
    expect(glazePictures(onlyJar)).toEqual({ cover: null, thumbnails: [] });
    expect(glazeThumbnail(onlyJar)).toBeNull();
    expect(glazeTestTile(onlyJar)).toBeNull();
    expect(hasResultPhoto([jar])).toBe(false);
    expect(selectPictures([jar, piece, tile].map((image) => ({ image })))).toEqual({
      cover: { image: tile },
      thumbnails: [{ image: piece }],
    });
    expect(glazeThumbnail(glazeOf('g', [jar, piece]))?.image).toEqual(piece);
    expect(hasResultPhoto([jar, piece])).toBe(true);
  });
  it('includes every own packaging photo in details, after results, with a packaging-only gallery', () => {
    const jar = image('jar', 'PACKAGING'),
      tile = image('tile', 'TEST_TILE'),
      piece = image('piece', 'FINISHED');
    const related = { image: piece, combination: { id: 'c', title: 'Combination', authorId: null } };
    expect(glazeGallery(glazeOf('g', [jar]))).toEqual({ cover: { image: jar }, thumbnails: [] });
    expect(glazeGallery(glazeOf('g', [jar, tile]), [related])).toEqual({
      cover: { image: tile },
      thumbnails: [related, { image: jar }],
    });
    expect(finishedPiecesByGlaze([combinationOf('c', ['g'], [jar])]).size).toBe(0);
    expect(pictureDescription({ image: jar }, 'Blue')).toEqual({
      key: 'images.alt.packaging',
      title: 'Blue',
    });
  });
});

describe('firing date order', () => {
  const dated = (id: string, kind: ImageInfo['kind'], firedOn: string | null) => imageInfo({ id, kind, firedOn });

  it('puts the latest firing first and keeps undated photos, and equal dates, in upload order after them', () => {
    // Upload order is newest first: u1 is the newest upload.
    const photos = [
      dated('u1', 'TEST_TILE', null),
      dated('d-old', 'TEST_TILE', '2026-01-02'),
      dated('u2', 'TEST_TILE', null),
      dated('d-new', 'TEST_TILE', '2026-10-14'),
      dated('d-same', 'TEST_TILE', '2026-01-02'),
    ];
    expect(orderByFiring(photos).map((photo) => photo.id)).toEqual(['d-new', 'd-old', 'd-same', 'u1', 'u2']);
    expect(photos.map((photo) => photo.id)).toEqual(['u1', 'd-old', 'u2', 'd-new', 'd-same']);
  });

  it('leaves photos without any date exactly as they are', () => {
    const photos = ['a', 'b', 'c'].map((id) => dated(id, 'TEST_TILE', null));
    expect(orderByFiring(photos).map((photo) => photo.id)).toEqual(['a', 'b', 'c']);
  });

  it('chooses the latest fired finished piece as a combination cover and orders each kind by firing', () => {
    const combo = combinationOf(
      'c',
      ['g'],
      [
        dated('newest-upload', 'TEST_TILE', '2026-02-01'),
        dated('fired-later', 'TEST_TILE', '2026-09-01'),
        dated('piece-old', 'FINISHED', '2026-03-01'),
        dated('piece-new', 'FINISHED', '2026-08-01'),
        dated('no-date', 'FINISHED', null),
      ],
    );
    const selection = combinationPictures(combo, Infinity);
    expect(selection.cover?.image.id).toBe('piece-new');
    expect(ids(selection.thumbnails)).toEqual(['piece-old', 'no-date', 'fired-later', 'newest-upload']);
  });

  it('follows a changed kind: a test tile edited into a finished piece becomes the cover', () => {
    const photos = [dated('piece', 'FINISHED', '2026-01-01'), dated('tile', 'TEST_TILE', '2026-06-01')];
    expect(combinationPictures(combinationOf('c', ['g'], photos)).cover?.image.id).toBe('piece');
    const edited = [photos[0], { ...photos[1], kind: 'FINISHED' as const }];
    expect(combinationPictures(combinationOf('c', ['g'], edited)).cover?.image.id).toBe('tile');
    const noPiece = [{ ...photos[0], kind: 'TEST_TILE' as const }, photos[1]];
    expect(combinationPictures(combinationOf('c', ['g'], noPiece)).cover?.image.id).toBe('tile');
  });

  it('keeps a glaze’s own photos before the combination photos it shows, each group by firing date', () => {
    const own = glazeOf('g', [dated('own-undated', 'FINISHED', null), dated('own-dated', 'FINISHED', '2026-01-01')]);
    const related = [{ image: dated('rel', 'FINISHED', '2026-12-01'), combination: { id: 'c', title: 'C', authorId: null } }];
    const gallery = glazeGallery(own, related);
    expect([gallery.cover, ...gallery.thumbnails].map((picture) => picture?.image.id)).toEqual(['own-dated', 'own-undated', 'rel']);
  });

  it('orders a glaze’s test tile, thumbnail and packaging photos by firing date too', () => {
    const glazeWith = glazeOf('g', [
      dated('t-undated', 'TEST_TILE', null),
      dated('t-dated', 'TEST_TILE', '2026-05-05'),
      dated('p-undated', 'PACKAGING', null),
      dated('p-dated', 'PACKAGING', '2026-04-04'),
    ]);
    expect(glazeTestTile(glazeWith)?.image.id).toBe('t-dated');
    expect(glazeThumbnail(glazeWith)?.image.id).toBe('t-dated');
    const gallery = glazeGallery(glazeWith);
    expect([gallery.cover, ...gallery.thumbnails].map((picture) => picture?.image.id)).toEqual(['t-dated', 't-undated', 'p-dated', 'p-undated']);
  });

  it('orders the finished pieces of each combination by firing date', () => {
    const combo = combinationOf('c', ['g'], [dated('a', 'FINISHED', null), dated('b', 'FINISHED', '2026-02-02')]);
    expect(ids(finishedPiecesByGlaze([combo]).get('g') ?? [])).toEqual(['b', 'a']);
  });
});

describe('pictureSrc', () => {
  it('loads the card copy for covers and thumbnails and the full size for the gallery', () => {
    const image = imageInfo({ id: 'i9' });
    expect(pictureSrc(image)).toBe('/api/images/i9/card');
    expect(pictureSrc(image, 'card')).toBe('/api/images/i9/card');
    expect(pictureSrc(image, 'full')).toBe('/api/images/i9');
  });
});

describe('stageShape', () => {
  const sized = (width: number, height: number) => ({ image: imageInfo({ width, height }) });

  it('is landscape when every photo is landscape', () => {
    expect(stageShape([sized(1600, 1200), sized(1200, 800)])).toBe('landscape');
  });

  it('follows the tallest photo of a mixed gallery', () => {
    expect(stageShape([sized(1600, 1200), sized(1200, 1600), sized(1000, 1000)])).toBe('portrait');
    expect(stageShape([sized(1600, 1200), sized(1000, 1000)])).toBe('square');
  });

  it('is portrait for a portrait photo', () => {
    expect(stageShape([sized(600, 900)])).toBe('portrait');
  });

  it('is square for a square photo and for near-square ones', () => {
    expect(stageShape([sized(1000, 1000)])).toBe('square');
    expect(stageShape([sized(1000, 1050), sized(1050, 1000)])).toBe('square');
  });

  it('keeps the exact thresholds square: portrait only above 1.1, landscape only below 0.9', () => {
    expect(stageShape([sized(1000, 1100)])).toBe('square');
    expect(stageShape([sized(1000, 1101)])).toBe('portrait');
    expect(stageShape([sized(1000, 900)])).toBe('square');
    expect(stageShape([sized(1000, 899)])).toBe('landscape');
  });

  it('ignores missing dimensions and is square without any', () => {
    expect(stageShape([])).toBe('square');
    expect(stageShape([sized(0, 0), sized(Number.NaN, 900)])).toBe('square');
    expect(stageShape([sized(0, 0), sized(600, 900)])).toBe('portrait');
    const undated = { image: { ...imageInfo(), width: undefined, height: undefined } as unknown as ReturnType<typeof imageInfo> };
    expect(stageShape([undated])).toBe('square');
  });
});

describe('the photos of a card in the viewer', () => {
  const photos = [
    imageInfo({ id: 'finished-old', kind: 'FINISHED', firedOn: '2026-01-02' }),
    imageInfo({ id: 'tile-new', kind: 'TEST_TILE', firedOn: '2026-05-01' }),
    imageInfo({ id: 'finished-new', kind: 'FINISHED', firedOn: '2026-05-03' }),
    imageInfo({ id: 'tile-undated', kind: 'TEST_TILE' }),
    imageInfo({ id: 'finished-undated', kind: 'FINISHED' }),
    imageInfo({ id: 'tile-old', kind: 'TEST_TILE', firedOn: '2026-01-01' }),
  ];
  const card = combinationOf('c1', [], photos);

  it('steps through all of them, the cover first and the rest as the detail gallery orders them', () => {
    const slides = viewerSlides(combinationPictures(card, Infinity));
    expect(ids(slides)).toEqual(['finished-new', 'finished-old', 'finished-undated', 'tile-new', 'tile-old', 'tile-undated']);
    // The detail page's gallery is the same list.
    expect(ids(slides)).toEqual(ids([combinationPictures(card, Infinity).cover!, ...combinationPictures(card, Infinity).thumbnails]));
  });

  it('starts with what the card shows: its cover and thumbnails are the first photos of the list', () => {
    const shown = combinationPictures(card);
    const slides = viewerSlides(combinationPictures(card, Infinity));
    expect(slides).toHaveLength(6);
    expect(shown.thumbnails).toHaveLength(3);
    expect(ids(slides.slice(0, 4))).toEqual(ids([shown.cover!, ...shown.thumbnails]));
    expect(viewerStart(slides, shown.cover!.image.id)).toBe(0);
    shown.thumbnails.forEach((thumbnail, position) => expect(viewerStart(slides, thumbnail.image.id)).toBe(position + 1));
  });

  it('is empty without a photo, and starts at the first photo when the clicked one is gone', () => {
    expect(viewerSlides(combinationPictures(combinationOf('c2', [], [])))).toEqual([]);
    expect(viewerSlides(glazePictures(glazeOf('g1')))).toEqual([]);
    const slides = viewerSlides(combinationPictures(card, Infinity));
    expect(viewerStart(slides, 'removed')).toBe(0);
    expect(viewerStart([], 'removed')).toBe(0);
  });

  it('puts a glaze row photo first and packaging last, as the glaze page does', () => {
    const glazeWithPhotos = glazeOf('g2', [image('packaging', 'PACKAGING'), image('finished', 'FINISHED'), image('tile', 'TEST_TILE')]);
    const slides = viewerSlides(glazeGallery(glazeWithPhotos));
    expect(ids(slides)).toEqual(['tile', 'finished', 'packaging']);
    expect(viewerStart(slides, glazeThumbnail(glazeWithPhotos)!.image.id)).toBe(0);
  });
});

describe('work in progress', () => {
  it('shows after the other kinds and is the cover only when there is nothing else', () => {
    const progress = { image: image('w', 'IN_PROGRESS') };
    const tile = { image: image('t', 'TEST_TILE') };
    const finished = { image: image('f', 'FINISHED') };
    expect(selectPictures([progress, finished, tile])).toEqual({ cover: tile, thumbnails: [finished, progress] });
    expect(selectPictures([progress])).toEqual({ cover: progress, thumbnails: [] });
  });

  it('is no result photo and never lends a glaze a finished piece', () => {
    expect(hasResultPhoto([image('w', 'IN_PROGRESS')])).toBe(false);
    expect(finishedPiecesByGlaze([combinationOf('c', ['g'], [image('w', 'IN_PROGRESS')])]).size).toBe(0);
  });

  it('has its own label and description', () => {
    expect(imageKindKey('IN_PROGRESS')).toBe('images.kind.inProgress');
    expect(pictureDescription({ image: image('w', 'IN_PROGRESS') }, 'Duo')).toEqual({ key: 'images.alt.inProgress', title: 'Duo' });
  });
});

describe('kinds per target', () => {
  it('offers packaging on a glaze and work in progress on a combination, never the other way round', () => {
    expect(kindsOn(true)).toEqual(['TEST_TILE', 'FINISHED', 'PACKAGING']);
    expect(kindsOn(false)).toEqual(['TEST_TILE', 'FINISHED', 'IN_PROGRESS']);
    expect([...IMAGE_KINDS].sort()).toEqual([...new Set([...kindsOn(true), ...kindsOn(false)])].sort());
  });

  it('reads a kind a newer API sends as a finished piece instead of failing, and leaves it out of the gallery', () => {
    const unknown = image('n', 'KILN_SHELF' as ImageInfo['kind']);
    expect(imageKindKey(unknown.kind)).toBe('images.kind.finished');
    expect(pictureDescription({ image: unknown }, 'Duo').key).toBe('images.alt.finished');
    expect(selectPictures([{ image: unknown }])).toEqual({ cover: null, thumbnails: [] });
  });
});
