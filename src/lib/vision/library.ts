import type { Combination, Glaze, ImageInfo } from '../api/models';
import { glazeTitle } from '../glazes/glazes';

/** The kinds of photo that are embedded and compared, each only with its own kind: packaging shows a label, not a look. */
export type LookKind = 'TEST_TILE' | 'FINISHED' | 'IN_PROGRESS';
export const LOOK_KINDS: readonly LookKind[] = ['FINISHED', 'TEST_TILE', 'IN_PROGRESS'];
export const isLookKind = (kind: ImageInfo['kind']): kind is LookKind => (LOOK_KINDS as readonly string[]).includes(kind);

export type ItemType = 'glaze' | 'combination';
export const itemKey = (type: ItemType, id: string) => `${type}:${id}`;

/** A photo of the loaded library that the similar looks can use: the viewer sees it, because the listings hold nothing else. */
export interface LibraryPhoto {
  id: string;
  kind: LookKind;
  image: ImageInfo;
  type: ItemType;
  itemId: string;
  title: string;
}

/** Every test tile, finished piece and work in progress of the listings by image ID (a picture belongs to one item). */
export function libraryPhotos(glazes: readonly Glaze[], combinations: readonly Combination[]): Map<string, LibraryPhoto> {
  const photos = new Map<string, LibraryPhoto>();
  const add = (type: ItemType, itemId: string, title: string, images: readonly ImageInfo[]) => {
    for (const image of images)
      if (isLookKind(image.kind) && !photos.has(image.id)) photos.set(image.id, { id: image.id, kind: image.kind, image, type, itemId, title });
  };
  for (const glaze of glazes) add('glaze', glaze.id, glazeTitle(glaze), glaze.images);
  for (const combination of combinations) add('combination', combination.id, combination.title, combination.images);
  return photos;
}
