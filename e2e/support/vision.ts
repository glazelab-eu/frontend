import { readdirSync, statSync } from 'node:fs';
import type { BrowserContext, Page, Route } from '@playwright/test';
import { join } from 'node:path';
import { DIST } from './paths';

/**
 * The photo suggestions (33-1) in the suite: a stand-in for the model and its label data, so the specs stay fast, offline and
 * deterministic while the real worker and the real ONNX Runtime WebAssembly build run. The stand-in "model" averages the image's
 * colour channels (`ReduceMean` over height and width: a 3-vector) and the stand-in labels are colours: a red photo is a mug, a
 * blue one a vase, a green one a bowl; white is closest to a label that is never suggested, so it gets no chip.
 *
 * The app checks every downloaded file against the size its build recorded (a cut-off download or a fallback page must never
 * be cached), so the stand-ins are padded to exactly the size of the real files in the build: the ONNX model through a
 * `metadata_props` entry (a protobuf field every reader skips), the labels through trailing spaces.
 */
/** The build was made with `GLAZELAB_VISION_MODEL=stand-in` (no real model, `scripts/vision-assets.ts`): `@vision-real` skips. */
export const STAND_IN_BUILD = process.env.GLAZELAB_VISION_MODEL === 'stand-in';
export const STAND_IN_BUILD_REASON = 'the build holds a stand-in instead of the real model (GLAZELAB_VISION_MODEL=stand-in)';

export const VISION_URL = /\/assets\/vision-[0-9a-f]{16}\/(model\.onnx|labels\.json)$/;

/** The built directory of the model files, and the size of each. */
function builtFiles(): Record<string, number> {
  const assets = join(DIST, 'assets');
  const directory = readdirSync(assets).find((name) => /^vision-[0-9a-f]{16}$/.test(name));
  if (!directory) throw new Error('the build has no vision-<hash> directory');
  return Object.fromEntries(readdirSync(join(assets, directory)).map((name) => [name, statSync(join(assets, directory, name)).size]));
}

const varint = (value: number): number[] => {
  const bytes: number[] = [];
  let rest = value;
  while (rest > 127) {
    bytes.push((rest & 127) | 128);
    rest = Math.floor(rest / 128);
  }
  return [...bytes, rest];
};
const bytesOf = (text: string) => [...Buffer.from(text)];
/** A length-delimited protobuf field. */
const field = (number: number, payload: number[] | Buffer) => [...varint(number * 8 + 2), ...varint(payload.length), ...payload];
const intField = (number: number, value: number) => [...varint(number * 8), ...varint(value)];
const text = (number: number, value: string) => field(number, bytesOf(value));

/** A `metadata_props` entry (field 14) whose value is `length` bytes, built as a buffer: the real model is 45 MB. */
function padding(key: string, length: number): Buffer {
  const pair = Buffer.concat([Buffer.from(text(1, key)), Buffer.from([...varint(2 * 8 + 2), ...varint(length)]), Buffer.alloc(length, 120)]);
  return Buffer.concat([Buffer.from([...varint(14 * 8 + 2), ...varint(pair.length)]), pair]);
}

/** An ONNX model (IR 8, opset 13): `ReduceMean(pixel_values, axes = [2, 3], keepdims = 0)` named `embedding`, padded to `size` bytes. */
export function standInModel(size: number): Buffer {
  const axes = [...text(1, 'axes'), ...field(8, [...varint(2), ...varint(3)]), ...intField(20, 7)];
  const keepdims = [...text(1, 'keepdims'), ...intField(3, 0), ...intField(20, 2)];
  const node = [...text(1, 'pixel_values'), ...text(2, 'embedding'), ...text(3, 'mean'), ...text(4, 'ReduceMean'), ...field(5, axes), ...field(5, keepdims)];
  const valueInfo = (name: string) => [...text(1, name), ...field(2, field(1, intField(1, 1)))];
  const graph = [...field(1, node), ...text(2, 'stand-in'), ...field(11, valueInfo('pixel_values')), ...field(12, valueInfo('embedding'))];
  const head = [...intField(1, 8), ...field(8, [...text(1, ''), ...intField(2, 13)]), ...field(7, graph)];
  // metadata_props (field 14): key/value pairs whose values pad the file to the wanted size. One entry's size jumps where its
  // length prefixes grow, so a size inside a jump is reached with a second, small entry.
  const entry = padding;
  const entrySize = (length: number) => 1 + varint(4 + varint(length).length + length).length + 4 + varint(length).length + length;
  const room = size - head.length;
  for (let small = 0; small <= 300; small++) {
    const rest = room - (small === 0 ? 0 : entrySize(small));
    for (let length = Math.max(0, rest - 24); length <= rest; length++) {
      if (entrySize(length) === rest) return Buffer.concat([Buffer.from(head), entry('p', length), ...(small === 0 ? [] : [entry('p', small)])]);
    }
  }
  throw new Error(`could not pad the stand-in model to ${size} bytes (its bare size is ${head.length})`);
}

export const STAND_IN_LABELS = {
  model: { id: 'stand-in', source: 'e2e', input: 8, mean: [0, 0, 0], std: [1, 1, 1], scale: 50, dimension: 3 },
  thresholds: { minProbability: 0.3, minCosine: 0.5, maxSuggestions: 3 },
  labels: [
    { id: 'mug', tags: { en: 'mug', de: 'becher', 'pt-PT': 'caneca', it: 'mug', es: 'mug' }, embedding: [1, 0, 0] },
    { id: 'vase', tags: { en: 'vase', de: 'vase', 'pt-PT': 'vaso', it: 'vaso', es: 'jarrón' }, embedding: [0, 0, 1] },
    { id: 'bowl', tags: { en: 'bowl', de: 'schale', 'pt-PT': 'tigela', it: 'ciotola', es: 'cuenco' }, embedding: [0, 1, 0] },
    { id: 'other-picture', tags: null, embedding: [0.57735, 0.57735, 0.57735] },
  ],
};

/** The stand-in labels as JSON, padded with spaces to `size` bytes. */
export function standInLabels(size: number): Buffer {
  // Bytes, not characters: a tag with an accent ("jarrón") takes two bytes in UTF-8.
  const json = Buffer.from(JSON.stringify(STAND_IN_LABELS));
  if (json.length > size) throw new Error('the stand-in labels are larger than the real file');
  return Buffer.concat([json, Buffer.alloc(size - json.length, ' ')]);
}

/** The stand-in files for what the build holds: `model.onnx` and `labels.json`, each as large as the real one. */
export function standInFiles(): { model: Buffer; labels: Buffer } {
  const sizes = builtFiles();
  return { model: standInModel(sizes['model.onnx']), labels: standInLabels(sizes['labels.json']) };
}

/** The size the app announces: the files it downloads (model, runtime, labels) in whole megabytes, rounded up. */
export function downloadMegabytes(): number {
  const sizes = builtFiles();
  return Math.max(1, Math.ceil((sizes['model.onnx'] + sizes['ort-wasm-simd-threaded.wasm'] + sizes['labels.json']) / 1_000_000));
}

/** Answers the model and the labels with the stand-ins (`control.fail` answers an error or an abort instead while it is set). */
export async function routeStandIn(target: Page | BrowserContext, control: { fail?: 'error' | 'offline' } = {}) {
  const files = standInFiles();
  await target.route(VISION_URL, async (route: Route) => {
    if (control.fail === 'error') return route.fulfill({ status: 500, body: 'no' });
    if (control.fail === 'offline') return route.abort('internetdisconnected');
    const model = route.request().url().endsWith('model.onnx');
    return route.fulfill({ status: 200, contentType: model ? 'application/octet-stream' : 'application/json', body: model ? files.model : files.labels });
  });
}
