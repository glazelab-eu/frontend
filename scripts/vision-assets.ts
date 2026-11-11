/// <reference types="node" />
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { DEFAULT_MODEL_URL, ensureModel, MODEL } from './vision-model-file';

/**
 * The files of the optional photo suggestions (33-1): the model and its label data (models/vision), the ONNX Runtime WebAssembly
 * build and a notice, on our origin under a directory named after a hash of their content. They are NOT precached (vite.config.ts);
 * the app downloads them after the user's consent into its own Cache Storage (`lib/vision/assets.ts`). `virtual:vision-assets`
 * tells the app where they are and how big.
 *
 * The model is not in git: a build takes `models/vision/model.onnx` (ignored by git) when it matches the pin of
 * `vision-model-file.ts`, else downloads it from `GLAZELAB_VISION_MODEL_URL`, and stops on anything else. The dev server obtains it
 * only when the model is requested. `GLAZELAB_VISION_MODEL=stand-in` (e2e suite, development without the model) puts a file of the
 * pinned size full of zeros in its place, under a directory of its own.
 */
export function visionAssets(): Plugin {
  const path = (name: string) => fileURLToPath(new URL(`../${name}`, import.meta.url));
  const mode = process.env.GLAZELAB_VISION_MODEL ?? '';
  if (mode !== '' && mode !== 'stand-in') throw new Error(`GLAZELAB_VISION_MODEL is "${mode}": leave it unset or set it to "stand-in".`);
  const standIn = mode === 'stand-in';
  const modelPath = path('models/vision/model.onnx');
  const url = process.env.GLAZELAB_VISION_MODEL_URL || DEFAULT_MODEL_URL;
  const files = new Map<string, Buffer>([
    ['labels.json', readFileSync(path('models/vision/labels.json'))],
    ['ort-wasm-simd-threaded.wasm', readFileSync(path('node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm'))],
    ['NOTICE.txt', readFileSync(path('scripts/vision-NOTICE.txt'))],
  ]);
  // The model enters the hash by its pin, so the directory is known before the file is there.
  const hash = createHash('sha256')
    .update('model.onnx')
    .update(standIn ? 'stand-in' : MODEL.sha256);
  for (const [name, content] of files) hash.update(name).update(content);
  const directory = `assets/vision-${hash.digest('hex').slice(0, 16)}`;
  const sizes: Record<string, number> = { 'model.onnx': MODEL.size };
  for (const name of ['labels.json', 'ort-wasm-simd-threaded.wasm']) sizes[name] = files.get(name)?.length ?? 0;
  const manifest = { base: `${directory}/`, files: sizes };

  let model: Promise<Buffer> | undefined;
  const loadModel = () =>
    (model ??= standIn
      ? Promise.resolve(Buffer.alloc(MODEL.size))
      : ensureModel({ path: modelPath, url, log: (line) => console.info(line) }).then((file) => readFile(file)));
  let command: 'build' | 'serve' = 'serve';
  const id = '\0virtual:vision-assets';
  return {
    name: 'vision-assets',
    configResolved: (config) => void (command = config.command),
    async buildStart() {
      if (command !== 'build') return;
      if (standIn) this.warn('GLAZELAB_VISION_MODEL=stand-in: the build holds no real model, so the photo suggestions do not work.');
      await loadModel();
    },
    resolveId: (source) => (source === 'virtual:vision-assets' ? id : undefined),
    load: (source) =>
      source === id
        ? `const manifest = ${JSON.stringify(manifest)}; export default { ...manifest, base: import.meta.env.BASE_URL + manifest.base };`
        : undefined,
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = request.url?.split('?')[0] ?? '';
        if (!pathname.startsWith(`/${directory}/`)) return next();
        const name = pathname.slice(directory.length + 2);
        const file = files.get(name);
        const content = name === 'model.onnx' ? loadModel() : file && Promise.resolve(file);
        if (!content) return next();
        content.then(
          (bytes) => {
            response.setHeader(
              'Content-Type',
              name.endsWith('.wasm') ? 'application/wasm' : name.endsWith('.json') ? 'application/json' : 'application/octet-stream',
            );
            response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            response.end(bytes);
          },
          (error: unknown) => {
            // The next request tries again (a download can fail for a moment).
            model = undefined;
            server.config.logger.error(error instanceof Error ? error.message : String(error));
            response.statusCode = 503;
            response.end();
          },
        );
      });
    },
    async generateBundle(_options, bundle) {
      // ONNX Runtime's glue names its wasm with `new URL(..., import.meta.url)`, which makes Vite emit a second 15 MB copy next
      // to the worker. The worker is handed the wasm bytes (`wasmBinary`) and never fetches that URL, so the copy is dropped.
      for (const key of Object.keys(bundle)) if (/^assets\/ort-wasm-simd-threaded[^/]*\.wasm$/.test(key)) delete bundle[key];
      this.emitFile({ type: 'asset', fileName: `${directory}/model.onnx`, source: await loadModel() });
      for (const [name, source] of files) this.emitFile({ type: 'asset', fileName: `${directory}/${name}`, source });
    },
  };
}
