/// <reference types="node" />
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

/** Keep the worker, external WASM and language data together, on our origin, with immutable URLs. */
export function ocrAssets(): Plugin {
  const files = new Map(
    [
      ['worker.min.js', 'tesseract.js/dist/worker.min.js'],
      ['tesseract-core-lstm.js', 'tesseract.js-core/tesseract-core-lstm.js'],
      ['tesseract-core-lstm.wasm', 'tesseract.js-core/tesseract-core-lstm.wasm'],
      ['eng.traineddata.gz', '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'],
      ['tesseract-LICENSE.txt', 'tesseract.js/LICENSE.md'],
      ['worker.min.js.LICENSE.txt', 'tesseract.js/dist/worker.min.js.LICENSE.txt'],
      ['core-LICENSE.txt', 'tesseract.js-core/LICENSE'],
    ].map(([name, source]) => [name, readFileSync(fileURLToPath(new URL(`../node_modules/${source}`, import.meta.url)))]),
  );
  // The trained data's own licence (naptha/tessdata); the npm data package ships none.
  files.set('model-LICENSE.txt', readFileSync(new URL('./notices/tessdata-LICENSE.txt', import.meta.url)));
  files.set('leptonica-LICENSE.txt', readFileSync(new URL('./notices/leptonica-LICENSE.txt', import.meta.url)));
  files.set('NOTICE.txt', readFileSync(new URL('./ocr-NOTICE.txt', import.meta.url)));
  const hash = createHash('sha256');
  for (const [name, content] of files) hash.update(name).update(content);
  const directory = `assets/ocr-${hash.digest('hex').slice(0, 16)}`;
  const id = '\0virtual:label-ocr-assets';
  return {
    name: 'label-ocr-assets',
    resolveId: (source) => (source === 'virtual:label-ocr-assets' ? id : undefined),
    load: (source) => (source === id ? `export default import.meta.env.BASE_URL + ${JSON.stringify(directory)};` : undefined),
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = request.url?.split('?')[0] ?? '';
        if (!pathname.startsWith(`/${directory}/`)) return next();
        const name = pathname.slice(directory.length + 2);
        const content = files.get(name);
        if (!content) return next();
        response.setHeader(
          'Content-Type',
          name.endsWith('.js') ? 'application/javascript' : name.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream',
        );
        response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        response.end(content);
      });
    },
    generateBundle() {
      for (const [name, source] of files) this.emitFile({ type: 'asset', fileName: `${directory}/${name}`, source });
    },
  };
}
