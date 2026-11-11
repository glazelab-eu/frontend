import { spawn } from 'node:child_process';
import { cp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { request } from '@playwright/test';
import { ENCODER_LOCK } from '../support/encoder-lock';
import { startBackend } from '../support/backend';
import { BACKEND_DIR, DIST, FRONTEND, OUTPUT } from '../support/paths';
import { startWebServer } from '../support/web-server';
import { seedLibrary } from './seed';

/** The seeded data and image folders, kept between runs (`GLAZELAB_VIDEOS_RESEED=1` seeds again). */
const SNAPSHOT = join(OUTPUT, '..', 'videos-seed');

function buildFrontend(): Promise<void> {
  // Iterating on a spec: `GLAZELAB_VIDEOS_REUSE_DIST=1` keeps the last build.
  if (process.env.GLAZELAB_VIDEOS_REUSE_DIST === '1' && existsSync(join(DIST, 'index.html'))) return Promise.resolve();
  return new Promise((done, fail) => {
    const vite = spawn(join(FRONTEND, 'node_modules', '.bin', 'vite'), ['build', '--outDir', DIST, '--emptyOutDir', '--logLevel', 'warn'], {
      cwd: FRONTEND,
      env: { ...process.env, GLAZELAB_BUILD: 'e2e' },
      stdio: 'inherit',
    });
    vite.once('error', fail);
    vite.once('exit', (code) => (code === 0 ? done() : fail(new Error(`vite build exited with ${code}`))));
  });
}

/** Seeds a fresh API once (all people, glazes, combinations with photos, clubs, buddies, shelves, reports) and keeps its folders. */
async function seedSnapshot(): Promise<void> {
  const backend = await startBackend();
  try {
    const contexts: Awaited<ReturnType<typeof request.newContext>>[] = [];
    const seeded = await seedLibrary(async () => {
      const context = await request.newContext({ baseURL: backend.url });
      contexts.push(context);
      return context;
    });
    await Promise.all(contexts.map((context) => context.dispose()));
    await backend.stop();
    await rm(SNAPSHOT, { recursive: true, force: true });
    await cp(BACKEND_DIR, SNAPSHOT, { recursive: true });
    await writeFile(join(SNAPSHOT, 'seed.json'), JSON.stringify(seeded, null, 2));
  } finally {
    await backend.stop();
  }
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  await rm(ENCODER_LOCK, { recursive: true, force: true });
  const needsSeed = process.env.GLAZELAB_VIDEOS_RESEED === '1' || !existsSync(join(SNAPSHOT, 'seed.json'));
  if (needsSeed) await seedSnapshot();
  const [started, built] = await Promise.allSettled([startBackend({ restoreFrom: SNAPSHOT }), buildFrontend()]);
  if (started.status === 'rejected') throw started.reason;
  const backend = started.value;
  if (built.status === 'rejected') {
    await backend.stop();
    throw built.reason;
  }
  const web = await startWebServer({ dist: DIST, apiUrl: backend.url });
  process.env.GLAZELAB_E2E_API_URL = backend.url;
  process.env.GLAZELAB_E2E_BASE_URL = web.url;
  process.env.GLAZELAB_VIDEOS_SEED = JSON.stringify(JSON.parse(await readFile(join(SNAPSHOT, 'seed.json'), 'utf8')));
  return async () => {
    await web.close();
    await backend.stop();
  };
}
