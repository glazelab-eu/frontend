import type { MessageKey } from '../i18n';
import type { Combination, Glaze, ImageInfo } from '../api/models';
import type { ImageVisibilityChange } from '../api/inputs';
import { glazeTitle } from '../glazes/glazes';
import { glazeIdsOf } from '../glazes/steps';

/** A picture shown on a card; `combination` is set when it comes from a combination using a glaze. */
export interface Picture {
  image: ImageInfo;
  combination?: { id: string; title: string; authorId: string | null };
}

export interface PictureSelection {
  cover: Picture | null;
  thumbnails: Picture[];
}

export const THUMBNAIL_LIMIT = 3;

/**
 * Photos with a firing date come first, the latest firing first; the rest keep their order after them.
 * The API lists photos newest upload first, so equal dates and photos without a date stay in upload order
 * (the sort is stable). A pure function over one list: a glaze's own photos and the combination photos it
 * borrows are ordered separately, so its own always come first.
 */
export function orderByFiring<T extends { firedOn?: string | null }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const first = a.firedOn;
    const second = b.firedOn;
    if (first && second) return first < second ? 1 : first > second ? -1 : 0;
    return first ? -1 : second ? 1 : 0;
  });
}

const orderPictures = (images: readonly ImageInfo[]): Picture[] => orderByFiring(images).map((image) => ({ image }));

/**
 * The kinds in the order a combination shows its photos. Kept as plain strings so a kind the generated
 * models do not know yet still sorts; a kind missing from the list sorts last.
 */
const PHOTO_KIND_ORDER: readonly string[] = ['FINISHED', 'TEST_TILE', 'IN_PROGRESS', 'PACKAGING'];

const kindRank = (kind: string): number => {
  const rank = PHOTO_KIND_ORDER.indexOf(kind);
  return rank < 0 ? PHOTO_KIND_ORDER.length : rank;
};

/** Photos by kind (`PHOTO_KIND_ORDER`): a stable sort, so photos of one kind keep their order (`orderByFiring`). */
export function orderPhotos<T extends { image: { kind: string } }>(pictures: readonly T[]): T[] {
  return [...pictures].sort((a, b) => kindRank(a.image.kind) - kindRank(b.image.kind));
}

/**
 * A glaze's cover is the first test tile, or the first finished piece when there is no test tile, or the first work in
 * progress when there is neither. Thumbnails show finished pieces first, then further test tiles, then work in progress,
 * so every kind stays visible. Packaging and a kind this version does not know are left out.
 * Input order is kept within each kind; the callers order by firing date first (`orderByFiring`).
 */
export function selectPictures(pictures: Picture[], limit = THUMBNAIL_LIMIT): PictureSelection {
  const tiles = pictures.filter((picture) => picture.image.kind === 'TEST_TILE');
  const finished = pictures.filter((picture) => picture.image.kind === 'FINISHED');
  const inProgress = pictures.filter((picture) => picture.image.kind === 'IN_PROGRESS');
  const cover = tiles[0] ?? finished[0] ?? inProgress[0] ?? null;
  const thumbnails = [...finished, ...tiles, ...inProgress].filter((picture) => picture !== cover);
  return { cover, thumbnails: thumbnails.slice(0, limit) };
}

/**
 * A combination's photos by firing date, then by kind (`orderPhotos`): a finished piece is the cover whenever there
 * is one. Cards, the detail gallery and both viewers all take this one list. Packaging never belongs to a combination.
 */
export function combinationPictures(combination: Combination, limit = THUMBNAIL_LIMIT): PictureSelection {
  const [cover = null, ...rest] = orderPhotos(
    orderPictures(combination.images.filter((image) => image.kind !== 'PACKAGING' && PHOTO_KIND_ORDER.includes(image.kind))),
  );
  return { cover, thumbnails: rest.slice(0, limit) };
}

/**
 * Finished pieces of each combination, indexed by every glaze applied in its steps. Combination test
 * tiles are left out: they show the combined result, not the single glaze.
 */
export function finishedPiecesByGlaze(combinations: Combination[]): Map<string, Picture[]> {
  const pieces = new Map<string, Picture[]>();
  for (const combination of combinations) {
    const finished = orderByFiring(combination.images.filter((image) => image.kind === 'FINISHED'));
    if (!finished.length) continue;
    const source = { id: combination.id, title: combination.title, authorId: combination.authorId };
    for (const glazeId of glazeIdsOf(combination)) {
      const list = pieces.get(glazeId) ?? [];
      list.push(...finished.map((image) => ({ image, combination: source })));
      pieces.set(glazeId, list);
    }
  }
  return pieces;
}

/** A glaze's own pictures come first; finished pieces from combinations using it follow. */
export function glazePictures(glaze: Glaze, related: Picture[] = [], limit = THUMBNAIL_LIMIT): PictureSelection {
  return selectPictures([...orderPictures(glaze.images), ...related], limit);
}

/** Packaging belongs in the glaze detail gallery, after its result photos, never in previews. */
export function glazeGallery(glaze: Glaze, related: Picture[] = []): PictureSelection {
  const results = glazePictures(glaze, related, Infinity);
  const pictures = [
    ...(results.cover ? [results.cover, ...results.thumbnails] : []),
    ...orderPictures(glaze.images.filter((image) => image.kind === 'PACKAGING')),
  ];
  return { cover: pictures[0] ?? null, thumbnails: pictures.slice(1) };
}

export function hasResultPhoto(images: ImageInfo[]): boolean {
  return images.some((image) => image.kind === 'TEST_TILE' || image.kind === 'FINISHED');
}

/**
 * Which size of a picture a view loads: covers, thumbnails and report rows the small card copy (`cardUrl`,
 * about 480 px), the detail gallery the full size (`url`, up to 1600 px). The offline cache keeps each
 * under its own URL, so a card never pulls the full size.
 */
export function pictureSrc(image: Pick<ImageInfo, 'url' | 'cardUrl'>, size: 'card' | 'full' = 'card'): string {
  return size === 'full' ? image.url : image.cardUrl;
}

/** The shape of the detail gallery's stage: every slide of one gallery gets the same, so swiping never changes the page's height. */
export type StageShape = 'landscape' | 'square' | 'portrait';

/**
 * The stage follows the tallest photo (the one with the greatest height over width), so a portrait test tile is never
 * cropped and a landscape one only gets bars above and below: portrait from 1.1, landscape up to 0.9 and square between.
 * A photo without usable dimensions (snapshots from before they were stored) is ignored; none left gives square.
 * The result is a modifier class of `PictureCover`, never an inline style (the CSP is `style-src 'self'`).
 */
export function stageShape(pictures: readonly { image: Pick<ImageInfo, 'width' | 'height'> }[]): StageShape {
  let tallest = 0;
  for (const { image } of pictures) {
    if (image.width > 0 && image.height > 0) tallest = Math.max(tallest, image.height / image.width);
  }
  if (!tallest) return 'square';
  return tallest > 1.1 ? 'portrait' : tallest < 0.9 ? 'landscape' : 'square';
}

/** Every kind in the order the pickers offer them; `kindsFor` (upload) and the type change narrow it per target. */
export const IMAGE_KINDS: readonly ImageInfo['kind'][] = ['TEST_TILE', 'FINISHED', 'IN_PROGRESS', 'PACKAGING'];

const KIND_LABEL: Record<ImageInfo['kind'], MessageKey> = {
  TEST_TILE: 'images.kind.tile',
  FINISHED: 'images.kind.finished',
  IN_PROGRESS: 'images.kind.inProgress',
  PACKAGING: 'images.kind.packaging',
};
const KIND_ALT: Record<ImageInfo['kind'], MessageKey> = {
  TEST_TILE: 'images.alt.tile',
  FINISHED: 'images.alt.finished',
  IN_PROGRESS: 'images.alt.inProgress',
  PACKAGING: 'images.alt.packaging',
};

/** The kinds a glaze's own photo (`glaze`) or a combination's photo may have: packaging is a glaze's, work in progress a combination's. */
export const kindsOn = (glaze: boolean): ImageInfo['kind'][] => IMAGE_KINDS.filter((kind) => (glaze ? kind !== 'IN_PROGRESS' : kind !== 'PACKAGING'));

/** The label of a kind; a kind a newer API sends and this version does not know reads as a finished piece. */
export function imageKindKey(kind: ImageInfo['kind']): MessageKey {
  return KIND_LABEL[kind] ?? 'images.kind.finished';
}

/** Accessible description: the picture kind and the glaze or combination it shows. */
export function pictureDescription(picture: Picture, title: string): { key: MessageKey; title: string } {
  return {
    key: KIND_ALT[picture.image.kind] ?? 'images.alt.finished',
    title: picture.combination?.title ?? title,
  };
}

/** Name the actual source, including combination photos displayed on a glaze's card. */
export function removalDescription(image: ImageInfo, glazes: Glaze[], combinations: Combination[]) {
  const glaze = glazes.find((item) => item.images.some((photo) => photo.id === image.id));
  const combination = combinations.find((item) => item.images.some((photo) => photo.id === image.id));
  return pictureDescription({ image }, glaze ? glazeTitle(glaze) : (combination?.title ?? image.id));
}

/** The glaze's own test tile first in firing order, or null; combination tiles show the steps together, not the glaze. */
export function glazeTestTile(glaze: Glaze | undefined): Picture | null {
  const tile = orderByFiring(glaze?.images ?? []).find((image) => image.kind === 'TEST_TILE');
  return tile ? { image: tile } : null;
}

/** A glaze's own photo for compact lists: its first test tile in firing order, else its first finished piece. */
export function glazeThumbnail(glaze: Pick<Glaze, 'images'> | undefined): Picture | null {
  const images = orderByFiring(glaze?.images ?? []);
  const image = images.find((photo) => photo.kind === 'TEST_TILE') ?? images.find((photo) => photo.kind === 'FINISHED');
  return image ? { image } : null;
}

/** The value of a picture's visibility choice: PUBLIC, PRIVATE or CLUB:<club ID>. */
export function visibilityChoice(image: Pick<ImageInfo, 'visibility' | 'clubId'>): string {
  return image.visibility === 'CLUB' ? `CLUB:${image.clubId ?? ''}` : image.visibility;
}

/** The request for a visibility choice made with `visibilityChoice` values. */
export function visibilityChange(choice: string): ImageVisibilityChange {
  if (choice.startsWith('CLUB:')) return { visibility: 'CLUB', clubId: choice.slice('CLUB:'.length) };
  return { visibility: choice === 'PUBLIC' ? 'PUBLIC' : 'PRIVATE' };
}

/**
 * The photos the full-screen viewer of a card steps through, in the order of the card's detail gallery: the cover
 * first, then the rest (a card shows the cover and at most three of them). A selection without a cover has none.
 */
export function viewerSlides(selection: PictureSelection): Picture[] {
  return selection.cover ? [selection.cover, ...selection.thumbnails] : [];
}

/** Where the viewer starts: the position of the clicked photo (by ID: the list may have changed), else the first. */
export function viewerStart(slides: readonly Picture[], imageId: string): number {
  return Math.max(
    0,
    slides.findIndex((picture) => picture.image.id === imageId),
  );
}
