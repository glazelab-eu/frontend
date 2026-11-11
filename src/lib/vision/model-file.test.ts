/// <reference types="node" />
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureModel, MODEL } from '../../../scripts/vision-model-file';

const bytes = new Uint8Array(70_000).map((_, index) => index % 251);
const pin = { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
const url = 'https://models.example/model.onnx';

/** A fetch that answers `body` in 4 kB chunks (or what `answer` returns) and records the URLs it was asked for. */
function fakeFetch(answer: () => Response | Promise<Response> = () => streamed(bytes)) {
  const requested: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    requested.push(String(input));
    return answer();
  }) as typeof fetch;
  return { fetcher, requested };
}

function streamed(body: Uint8Array, status = 200): Response {
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= body.length) return controller.close();
      controller.enqueue(body.slice(offset, offset + 4096));
      offset += 4096;
    },
  });
  return new Response(stream, { status });
}

let directory: string;
let path: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'vision-model-'));
  path = join(directory, 'vision', 'model.onnx');
});
afterEach(() => rm(directory, { recursive: true, force: true }));

describe('the vision model file', () => {
  it('pins the shipped model', () => {
    expect(MODEL).toEqual({ size: 45_060_732, sha256: '71c8c1153bac5abe6c54829bee3a2978bb009ad27d0cdc01a6a1cbd23a667b8d' });
  });

  it('downloads a missing model, checks it and moves it into place', async () => {
    const { fetcher, requested } = fakeFetch();
    await expect(ensureModel({ path, url, pin, fetcher })).resolves.toBe(path);
    expect(requested).toEqual([url]);
    expect(new Uint8Array(await readFile(path))).toEqual(bytes);
    expect(await readdir(join(directory, 'vision'))).toEqual(['model.onnx']);
  });

  it('uses a cached model that matches the pin without asking the network', async () => {
    await ensureModel({ path, url, pin, fetcher: fakeFetch().fetcher });
    const { fetcher, requested } = fakeFetch(() => Promise.reject(new TypeError('fetch failed: getaddrinfo EAI_AGAIN')));
    await expect(ensureModel({ path, url, pin, fetcher })).resolves.toBe(path);
    await expect(ensureModel({ path, url: '', pin, fetcher })).resolves.toBe(path);
    expect(requested).toEqual([]);
  });

  it('refuses a download whose checksum differs and keeps nothing of it', async () => {
    const other = bytes.slice();
    other[123] ^= 1;
    await expect(ensureModel({ path, url, pin, fetcher: fakeFetch(() => streamed(other)).fetcher })).rejects.toThrow(/does not match the pin/);
    expect(existsSync(path)).toBe(false);
    expect(await readdir(join(directory, 'vision'))).toEqual([]);
  });

  it('refuses a download of another size: cut off or too long', async () => {
    await expect(ensureModel({ path, url, pin, fetcher: fakeFetch(() => streamed(bytes.slice(0, 1000))).fetcher })).rejects.toThrow(/1000 bytes/);
    const longer = new Uint8Array(bytes.length + 10);
    longer.set(bytes);
    await expect(ensureModel({ path, url, pin, fetcher: fakeFetch(() => streamed(longer)).fetcher })).rejects.toThrow(/more than 70000 bytes/);
    expect(existsSync(path)).toBe(false);
  });

  it('refuses an error answer', async () => {
    await expect(ensureModel({ path, url, pin, fetcher: fakeFetch(() => streamed(new Uint8Array(10), 404)).fetcher })).rejects.toThrow(/answered 404/);
    expect(existsSync(path)).toBe(false);
  });

  it('fails offline without a cached model and says how to provide one', async () => {
    const { fetcher } = fakeFetch(() => Promise.reject(new TypeError('fetch failed: getaddrinfo EAI_AGAIN')));
    const failure = ensureModel({ path, url, pin, fetcher });
    await expect(failure).rejects.toThrow(/could not be downloaded.*EAI_AGAIN/);
    await expect(failure).rejects.toThrow(/GLAZELAB_VISION_MODEL_URL.*vision-model\.py.*GLAZELAB_VISION_MODEL=stand-in/);
    expect(existsSync(path)).toBe(false);
  });

  it('fails without a URL and without a cached model', async () => {
    const { fetcher, requested } = fakeFetch();
    await expect(ensureModel({ path, url: '', pin, fetcher })).rejects.toThrow(/missing and no download URL is set/);
    expect(requested).toEqual([]);
  });

  it('refuses a cached file that differs from the pin and never replaces it', async () => {
    await mkdir(join(directory, 'vision'));
    const stale = bytes.slice();
    stale[0] ^= 1;
    await writeFile(path, stale);
    const { fetcher, requested } = fakeFetch();
    await expect(ensureModel({ path, url, pin, fetcher })).rejects.toThrow(/is not the pinned vision model.*SHA-256/);
    await writeFile(path, bytes.slice(1));
    await expect(ensureModel({ path, url, pin, fetcher })).rejects.toThrow(/69999 bytes; expected 70000/);
    expect(requested).toEqual([]);
    expect(new Uint8Array(await readFile(path))).toEqual(bytes.slice(1));
  });
});
