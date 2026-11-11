import type { Api } from './api';
import { BISQUE_STEP } from './api';
import { png } from './images';

// The suite's server is shared and its public photos are everyone's: the seeded photos are PRIVATE (only the seeding account sees them,
// so no other test's photos tie with them) and their colours are distinctive (an orange pair and a teal pair), so nothing another
// spec uploaded publicly can look more like them. The stand-in model reads a photo as its mean colour.
export const ORANGE = [200, 120, 30] as const;
export const ORANGE_2 = [190, 115, 40] as const;
export const TEAL = [30, 120, 200] as const;
export const tile = (name: string, colour: readonly [number, number, number]) => png(name, [...colour], 96, 96);

export interface Library {
  glaze: { red: string; crimson: string; blue: string };
  glazeTitle: { red: string; crimson: string; blue: string };
  combination: { x: string; y: string; z: string };
  title: { x: string; y: string; z: string };
  photos: string[];
}

/**
 * Three glazes with a test tile (orange `red`, orange `crimson`, teal `blue`) and three combinations with a finished piece (orange X,
 * orange Y, teal Z); X also has a teal test tile. Seven private photos in all.
 */
export async function seedSimilar(api: Api, uid: string): Promise<Library> {
  const first = await api.addGlaze({ newManufacturer: { name: `Maker ${uid}`, shortId: uid }, code: 'R1', name: `Red ${uid}` });
  const manufacturerId = first.glaze.manufacturer.id;
  const crimson = await api.addGlaze({ manufacturerId, code: 'R2', name: `Crimson ${uid}` });
  const blue = await api.addGlaze({ manufacturerId, code: 'B1', name: `Blue ${uid}` });
  const photos: string[] = [];
  const glazePhoto = async (id: string, colour: readonly [number, number, number], name: string) =>
    photos.push((await api.uploadToGlaze(id, { file: tile(name, colour), kind: 'TEST_TILE', visibility: 'PRIVATE' })).id);
  await glazePhoto(first.glaze.id, ORANGE, 'orange-tile.png');
  await glazePhoto(crimson.glaze.id, ORANGE_2, 'orange-2-tile.png');
  await glazePhoto(blue.glaze.id, TEAL, 'teal-tile.png');
  const title = { x: `Xenon ${uid}`, y: `Yarrow ${uid}`, z: `Zinc ${uid}` };
  const x = await api.addCombination({ title: title.x, steps: [BISQUE_STEP] });
  const y = await api.addCombination({ title: title.y, steps: [BISQUE_STEP] });
  const z = await api.addCombination({ title: title.z, steps: [BISQUE_STEP] });
  const piece = async (id: string, colour: readonly [number, number, number], name: string, kind: 'FINISHED' | 'TEST_TILE' = 'FINISHED') =>
    photos.push((await api.uploadToCombination(id, { file: tile(name, colour), kind, visibility: 'PRIVATE' })).id);
  await piece(x, ORANGE, 'x-piece.png');
  await piece(x, [30, 125, 195], 'x-tile.png', 'TEST_TILE');
  await piece(y, [205, 125, 25], 'y-piece.png');
  await piece(z, [25, 115, 205], 'z-piece.png');
  return {
    glaze: { red: first.glaze.id, crimson: crimson.glaze.id, blue: blue.glaze.id },
    glazeTitle: { red: `Maker ${uid} R1 Red ${uid}`, crimson: `Maker ${uid} R2 Crimson ${uid}`, blue: `Maker ${uid} B1 Blue ${uid}` },
    combination: { x, y, z },
    title,
    photos,
  };
}
