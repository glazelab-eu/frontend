/// <reference types="node" />
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import license, { type Dependency } from 'rollup-plugin-license';
import type { Plugin } from 'vite';

/** The served file, linked from the footer (`lib/layout/legal-links.ts`). */
export const THIRD_PARTY_FILE = 'THIRD-PARTY-LICENSES.txt';

const read = (path: string) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8');
const versionOf = (name: string) => (JSON.parse(read(`node_modules/${name}/package.json`)) as { version: string }).version;

/**
 * Software in the build that the bundler does not see as an imported package: the service worker's Workbox runtime (built by
 * vite-plugin-pwa), code compiled into WebAssembly (zxing-cpp, ONNX Runtime with Eigen and the rest of its notices, Tesseract
 * with Leptonica) and the copied OCR files. Texts the npm packages do not ship are kept in `scripts/notices/`.
 */
function handWritten(): { title: string; text: string }[] {
  const workbox = versionOf('workbox-core');
  return [
    {
      title: `Workbox ${workbox} (workbox-core, workbox-precaching, workbox-routing, workbox-strategies, workbox-expiration; in sw.js and workbox-*.js), MIT`,
      text: read('node_modules/workbox-core/LICENSE'),
    },
    { title: `idb ${versionOf('idb')} (used by workbox-expiration in sw.js), ISC`, text: read('node_modules/idb/LICENSE') },
    {
      title: `onnxruntime-web ${versionOf('onnxruntime-web')}, MIT (the npm package ships no licence file)`,
      text: read('scripts/notices/onnxruntime-LICENSE.txt'),
    },
    {
      title: `ONNX Runtime ${versionOf('onnxruntime-web')} third-party notices (compiled into ort-wasm-simd-threaded.wasm; Eigen is MPL-2.0)`,
      text: read('scripts/notices/onnxruntime-ThirdPartyNotices.txt'),
    },
    {
      title: `zxing-cpp (compiled into zxing-wasm ${versionOf('zxing-wasm')}'s zxing_reader.wasm), Apache-2.0`,
      text: read('scripts/notices/zxing-cpp-LICENSE.txt'),
    },
    { title: `Tesseract.js ${versionOf('tesseract.js')} (the OCR worker), Apache-2.0`, text: read('node_modules/tesseract.js/LICENSE.md') },
    {
      title: `Tesseract.js-core ${versionOf('tesseract.js-core')} (Tesseract OCR compiled into tesseract-core-lstm.wasm), Apache-2.0`,
      text: read('node_modules/tesseract.js-core/LICENSE'),
    },
    { title: 'Leptonica (compiled into tesseract-core-lstm.wasm), BSD-2-Clause', text: read('scripts/notices/leptonica-LICENSE.txt') },
    {
      title: `English trained data (tessdata, via @tesseract.js-data/eng ${versionOf('@tesseract.js-data/eng')}), Apache-2.0`,
      text: read('scripts/notices/tessdata-LICENSE.txt'),
    },
  ];
}

/** Bundled packages without a licence file of their own: their text is one of the hand-written sections. */
const COVERED_BY_HAND = new Set(['onnxruntime-web']);

const RULE = '-'.repeat(80);

/** The notice file: the bundled packages (name order, one entry per version) and then the hand-written sections. */
export function renderNotices(dependencies: Dependency[], extra: { title: string; text: string }[]): string {
  const sections = dependencies.map((dependency) => {
    const head = `${dependency.name} ${dependency.version ?? ''}, ${dependency.license ?? 'no licence field'}`.replace(/\s+,/, ',');
    const body = [dependency.licenseText, dependency.noticeText].filter((text): text is string => !!text?.trim()).join('\n\n');
    return `${RULE}\n${head}\n\n${body || 'See the section of the same name below.'}\n`;
  });
  const rest = extra.map(({ title, text }) => `${RULE}\n${title}\n\n${text.trim()}\n`);
  // The byte order mark tells a browser the text is UTF-8: Nginx serves `.txt` as `text/plain` without a charset.
  return [
    '﻿Third-party software in the Glazelab web app',
    '',
    'Glazelab is free software under the GNU Affero General Public License, version 3 or later; its source code is linked from',
    "the app's footer. This build of its web app contains the following third-party software, each under its own licence.",
    '',
    ...sections,
    ...rest,
  ].join('\n');
}

/**
 * Collects the licences of every package bundled into the app (main build and its workers) through `rollup-plugin-license` and
 * writes `THIRD-PARTY-LICENSES.txt` at the root of the output. The build fails when a bundled package has no licence text that
 * is not covered by hand, when nothing was collected, or when the written file is missing or empty.
 */
export function thirdPartyLicenses(): { plugins: Plugin[]; worker: () => Plugin[] } {
  const found = new Map<string, Dependency>();
  const collector = (): Plugin => ({
    ...(license({
      thirdParty: {
        multipleVersions: true,
        output: (dependencies: Dependency[]) => {
          for (const dependency of dependencies) found.set(`${dependency.name}@${dependency.version}`, dependency);
        },
      },
    }) as Plugin),
    apply: 'build',
  });
  const writer: Plugin = {
    name: 'third-party-licenses',
    apply: 'build',
    generateBundle() {
      const dependencies = [...found.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
      if (dependencies.length === 0) this.error('No bundled third-party package was found: THIRD-PARTY-LICENSES.txt would be empty.');
      const missing = dependencies.filter((dependency) => !dependency.licenseText?.trim() && !COVERED_BY_HAND.has(dependency.name ?? ''));
      if (missing.length > 0) {
        this.error(`No licence text for ${missing.map((dependency) => `${dependency.name}@${dependency.version}`).join(', ')}: add one to scripts/notices/.`);
      }
      this.emitFile({ type: 'asset', fileName: THIRD_PARTY_FILE, source: renderNotices(dependencies, handWritten()) });
    },
    writeBundle(options) {
      const size = statSync(join(options.dir ?? 'dist', THIRD_PARTY_FILE), { throwIfNoEntry: false })?.size ?? 0;
      if (size === 0) this.error(`${THIRD_PARTY_FILE} is missing or empty in the build output.`);
    },
  };
  return { plugins: [collector(), writer], worker: () => [collector()] };
}
