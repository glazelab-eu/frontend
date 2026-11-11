import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The frontend repository. */
export const FRONTEND = resolve(fileURLToPath(new URL('../..', import.meta.url)));

/** The folder every browser run writes under (`GLAZELAB_E2E_HOME`, default `glazelab-e2e` in the OS temp folder); never inside the repository. */
export const E2E_HOME = resolve(process.env.GLAZELAB_E2E_HOME ?? join(tmpdir(), 'glazelab-e2e'));

/**
 * Everything one run writes (build, backend data, reports, traces, screenshots): `GLAZELAB_E2E_OUTPUT`, else the run's folder
 * `GLAZELAB_E2E_RUN` (default `suite`; the walkthrough and video scripts name their own) under `E2E_HOME`.
 */
export const OUTPUT = resolve(process.env.GLAZELAB_E2E_OUTPUT ?? join(E2E_HOME, process.env.GLAZELAB_E2E_RUN ?? 'suite'));
export const DIST = join(OUTPUT, 'dist');
export const BACKEND_DIR = join(OUTPUT, 'backend');
export const FIXTURES = join(OUTPUT, 'fixtures');
export const TMP = join(OUTPUT, 'tmp');

/** The API JAR of a backend checkout next to this repository (`../backend`, built with `mvn -DskipTests package`), or `GLAZELAB_E2E_JAR`. */
export const JAR = resolve(process.env.GLAZELAB_E2E_JAR ?? join(FRONTEND, '..', 'backend', 'target', 'glazelab-0.1.0.jar'));

/** The system Chromium when present (`CHROME_BINARY` overrides it), else Playwright's own (`npx playwright install chromium`). */
export function chromeBinary(): string | undefined {
  if (process.env.CHROME_BINARY) return process.env.CHROME_BINARY;
  return ['/usr/bin/chromium-browser', '/usr/bin/chromium'].find((path) => existsSync(path));
}
