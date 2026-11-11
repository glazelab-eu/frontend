import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { ENCODER_LOCK } from './support/encoder-lock';
import { startBackend } from './support/backend';
import { DIST, FRONTEND } from './support/paths';
import { startWebServer } from './support/web-server';

function buildFrontend(): Promise<void> {
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

/** Builds the frontend and starts the API and the web server once per run; the tests read their URLs from the environment. */
export default async function globalSetup(): Promise<() => Promise<void>> {
  await rm(ENCODER_LOCK, { recursive: true, force: true });
  const [started, built] = await Promise.allSettled([startBackend(), buildFrontend()]);
  if (started.status === 'rejected') throw started.reason;
  const backend = started.value;
  if (built.status === 'rejected') {
    await backend.stop();
    throw built.reason;
  }
  const web = await startWebServer({ dist: DIST, apiUrl: backend.url });
  process.env.GLAZELAB_E2E_API_URL = backend.url;
  process.env.GLAZELAB_E2E_BASE_URL = web.url;
  return async () => {
    await web.close();
    await backend.stop();
  };
}
