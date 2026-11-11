import { svelte } from '@sveltejs/vite-plugin-svelte';
import { rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * Builds the QR harness page (this directory) into `outDir` the way the app is built (Svelte runes, an external stylesheet, the lazy chunk
 * of the QR component), so the production Content-Security-Policy of `startWebServer` applies to it.
 */
export async function buildQrHarness(outDir: string): Promise<void> {
  await rm(outDir, { recursive: true, force: true });
  await build({
    root: ROOT,
    configFile: false,
    logLevel: 'warn',
    plugins: [svelte({ dynamicCompileOptions: ({ filename }) => (filename.includes('/node_modules/') ? undefined : { runes: true }) })],
    build: { outDir, emptyOutDir: true },
  });
}
