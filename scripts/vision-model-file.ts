/// <reference types="node" />
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * The photo-suggestion model (TinyCLIP ViT-40M/32 image tower, 8-bit, MIT) is not in git: the build obtains it and checks it
 * against this pin. `scripts/vision-model.py` makes exactly these bytes from the pinned onnx-community export.
 */
export const MODEL = {
  size: 45_060_732,
  sha256: '71c8c1153bac5abe6c54829bee3a2978bb009ad27d0cdc01a6a1cbd23a667b8d',
} as const;

/** Where the published copy of the quantised model lives (a release asset of this repository); `GLAZELAB_VISION_MODEL_URL` replaces it. The download is checked against `MODEL`. */
export const DEFAULT_MODEL_URL = 'https://github.com/glazelab-eu/frontend/releases/download/vision-model-1/model.onnx';

export type ModelPin = { size: number; sha256: string };

export async function sha256Of(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

const sizeOf = (path: string) =>
  stat(path).then(
    (info) => info.size,
    () => undefined,
  );

/** Why the build stops: what it found and the three ways to provide the model. */
const help = (path: string) =>
  `Provide it in one of these ways: set GLAZELAB_VISION_MODEL_URL to a copy of it (it is downloaded to ${path} and checked); ` +
  `or build it with scripts/vision-model.py (frontend/docs/guide/vision.md); or, for the e2e suite and development only, ` +
  `set GLAZELAB_VISION_MODEL=stand-in (the photo suggestions then do not work).`;

/**
 * Makes sure `path` holds the pinned model and answers its path. A file already there is used when it matches the pin and
 * refused when it does not (it is never replaced silently). A missing file is downloaded from `url` into a temporary file
 * beside it and moved into place only after its size and SHA-256 matched. Every failure throws with what to do.
 */
export async function ensureModel(options: { path: string; url: string; pin?: ModelPin; fetcher?: typeof fetch; log?: (line: string) => void }) {
  const { path, url, pin = MODEL, fetcher = fetch, log = () => undefined } = options;
  const present = await sizeOf(path);
  if (present !== undefined) {
    const sha = present === pin.size ? await sha256Of(path) : undefined;
    if (sha === pin.sha256) return path;
    throw new Error(
      `${path} is not the pinned vision model (${present} bytes${sha ? `, SHA-256 ${sha}` : ''}; expected ${pin.size} bytes, SHA-256 ${pin.sha256}). ` +
        `Delete it to download it again, or update the pin in scripts/vision-model-file.ts together with the model (frontend/docs/guide/vision.md).`,
    );
  }
  if (!url) throw new Error(`The vision model ${path} is missing and no download URL is set. ${help(path)}`);

  log(`downloading the vision model from ${url}`);
  await mkdir(dirname(path), { recursive: true });
  const partial = `${path}.download`;
  try {
    let response: Response;
    try {
      response = await fetcher(url, { signal: AbortSignal.timeout(10 * 60_000) });
    } catch (error) {
      throw new Error(`The vision model could not be downloaded from ${url} (${error instanceof Error ? error.message : String(error)}). ${help(path)}`);
    }
    if (!response.ok || !response.body) throw new Error(`The vision model download from ${url} answered ${response.status}. ${help(path)}`);
    const hash = createHash('sha256');
    let size = 0;
    const file = await open(partial, 'w');
    try {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        size += chunk.length;
        if (size > pin.size) break;
        hash.update(chunk);
        await file.write(chunk);
      }
    } finally {
      await file.close();
    }
    const sha = hash.digest('hex');
    if (size !== pin.size || sha !== pin.sha256) {
      throw new Error(
        `The vision model downloaded from ${url} does not match the pin (${size > pin.size ? `more than ${pin.size}` : size} bytes, SHA-256 ${sha}; ` +
          `expected ${pin.size} bytes, SHA-256 ${pin.sha256}).`,
      );
    }
    await rename(partial, path);
    return path;
  } finally {
    await rm(partial, { force: true });
  }
}
