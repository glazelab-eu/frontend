/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import { ocrAssets } from './scripts/ocr-assets';
import { visionAssets } from './scripts/vision-assets';
import { appVersion, versionMeta } from './scripts/build-version';
import { appColors, themeColor } from './scripts/theme-color';
import { thirdPartyLicenses } from './scripts/third-party-licenses';

const colors = appColors();
const version = appVersion();
// THIRD-PARTY-LICENSES.txt: the licences of everything bundled, workers included (a .txt file, so outside the precache's globs).
const licences = thirdPartyLicenses();

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  // The photo-suggestion worker (lib/vision/vision-worker.ts) bundles ONNX Runtime Web, which is an ES module.
  worker: { format: 'es', plugins: licences.worker },
  plugins: [
    ...licences.plugins,
    ocrAssets(),
    visionAssets(),
    themeColor(colors.theme),
    versionMeta(version),
    svelte({
      dynamicCompileOptions: ({ filename }) => {
        // Enforce runes in application components without changing dependency components.
        const path = filename.replaceAll('\\', '/');
        // Rune modules and their tests (`*.svelte.ts`, Node, no DOM) run the client runtime under
        // Vitest, whose SSR transform would otherwise compile effects away.
        if (process.env.VITEST && /\.svelte(\.test)?\.ts$/.test(path)) return { runes: true, generate: 'client' };
        if (!path.includes('/node_modules/')) return { runes: true };
      },
    }),
    VitePWA({
      // A new worker waits until the user accepts it (lib/pwa/update.ts); never set `skipWaiting` here, which would defeat the prompt.
      registerType: 'prompt',
      // lib/pwa/update.ts registers the worker through `workbox-window` itself: no injected script, no `virtual:pwa-register`.
      injectRegister: false,
      includeAssets: ['icon.svg', 'favicon.ico', 'apple-touch-icon.png'],
      manifest: {
        name: 'glazelab',
        short_name: 'glazelab',
        description: 'Your glaze library, stock and tests',
        theme_color: colors.theme,
        background_color: colors.background,
        display: 'standalone',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: '/icon-maskable-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // The page that installs the first worker is controlled at once (as `autoUpdate` did). An update still waits for the skip-waiting
        // message of an accepting tab (`reloadApp`), which `clientsClaim` does not change.
        clientsClaim: true,
        navigateFallback: '/index.html',
        // robots.txt is for crawlers (which run no service worker), so it is neither precached nor
        // answered with the app shell when opened in a browser; API URLs (health, images) open directly.
        // Any other path whose last segment has a file extension (the licence notices `/THIRD-PARTY-LICENSES.txt`) is a real file
        // the server answers itself, never a route: without this the worker answered it with the shell's "not found" page.
        navigateFallbackDenylist: [/^\/robots\.txt$/, /^\/api\//, /\/[^/?]+\.[^/]+$/],
        // The barcode scanner's ZXing fallback (lib/barcodes/barcode-fallback.ts, ~1 MB with its
        // wasm) is needed only by browsers without BarcodeDetector, so it is not precached for
        // everyone; after its first use it is kept for offline scanning.
        // The optional photo suggestions (33-1: worker with ONNX Runtime Web, the runtime's wasm, the model and the label data, about
        // 25 MB) are not precached either: the app downloads them after the person's consent into the `vision-model` cache
        // (lib/vision/assets.ts), and the worker script is kept there by the route below.
        globIgnores: ['**/barcode-fallback-*.js', '**/zxing_reader-*.wasm', '**/label-reader-*.js', '**/ocr-*/**', '**/vision-worker-*.js', '**/vision-*/**'],
        runtimeCaching: [
          {
            urlPattern: /\/assets\/(?:ocr-[a-f0-9]{16}\/[^/]+|label-reader-[^/]+\.js)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'label-ocr',
              expiration: { maxEntries: 16, purgeOnQuotaError: true },
            },
          },
          {
            urlPattern: /\/assets\/vision-worker-[^/]+\.js$/,
            handler: 'CacheFirst',
            options: { cacheName: 'vision-model', expiration: { maxEntries: 4, purgeOnQuotaError: true } },
          },
          {
            urlPattern: /\/assets\/(?:barcode-fallback-[^/]+\.js|zxing_reader-[^/]+\.wasm)$/,
            handler: 'CacheFirst',
            options: { cacheName: 'barcode-scanner', expiration: { maxEntries: 4 } },
          },
        ],
      },
    }),
  ],
  server: { proxy: { '/api': 'http://localhost:8080' } },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
