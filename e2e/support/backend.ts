import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { cp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { BACKEND_DIR, JAR, TMP } from './paths';
import { freePort } from './ports';

/** The operator address the API answers to "Show contact address". */
export const OPERATOR_EMAIL = 'operator@example.test';
/** The suite's `GLAZELAB_SOURCE_URL`, so the footer shows its source link (hidden while unset: Vitest `source-links.test.ts`). */
export const SOURCE_URL = 'https://code.example.test/glazelab';

export interface Backend {
  url: string;
  stop(): Promise<void>;
}

/**
 * The real API on the dev profile: a fresh file H2 database and image folder per run, no SMTP (mail-free sign-up), every rate
 * limit budget scaled by 100 so the suite, which comes from one address, stays within them.
 */
export async function startBackend(options: { restoreFrom?: string } = {}): Promise<Backend> {
  if (!existsSync(JAR)) throw new Error(`No API JAR at ${JAR}: run "mvn -DskipTests package" in backend/ or set GLAZELAB_E2E_JAR.`);
  await rm(BACKEND_DIR, { recursive: true, force: true });
  await mkdir(BACKEND_DIR, { recursive: true });
  // The page videos start from a seeded snapshot of the data and image folders instead of seeding again.
  if (options.restoreFrom) await cp(options.restoreFrom, BACKEND_DIR, { recursive: true });
  await mkdir(TMP, { recursive: true });
  const port = await freePort();
  const log = createWriteStream(join(BACKEND_DIR, 'api.log'));
  // `h2.bindAddress` keeps the database's AUTO_SERVER on loopback: it listens on 127.0.0.1 only and its lock file names
  // `localhost`, so `support/site-admin.ts` still reaches it when the host's network address changes during a run (a DHCP renewal
  // on Wi-Fi made every later admin test fail with "Connect timed out" on the old address).
  const java: ChildProcess = spawn(
    'java',
    [`-Djava.io.tmpdir=${TMP}`, '-Dh2.bindAddress=127.0.0.1', '-jar', JAR, `--server.port=${port}`, '--server.address=127.0.0.1'],
    {
      cwd: BACKEND_DIR,
      env: {
        ...process.env,
        SPRING_PROFILES_ACTIVE: 'dev',
        GLAZELAB_DATA: join(BACKEND_DIR, 'data'),
        GLAZELAB_IMAGES: join(BACKEND_DIR, 'images'),
        // AUTO_SERVER lets `support/site-admin.ts` open the same database from a second process (the API has no endpoint that makes an admin).
        SPRING_DATASOURCE_URL: `jdbc:h2:file:${join(BACKEND_DIR, 'data', 'glazelab')};AUTO_SERVER=TRUE`,
        GLAZELAB_STORAGE: 'file',
        GLAZELAB_SMTP_HOST: '',
        GLAZELAB_RATE_LIMIT_FACTOR: '100',
        GLAZELAB_OPERATOR_EMAIL: OPERATOR_EMAIL,
        GLAZELAB_SOURCE_URL: SOURCE_URL,
        // Every SQL error with its whole cause chain in api.log (Hibernate logs only the message at WARN): E2E-register-1's 409 was
        // an H2 CHECK_CONSTRAINT_INVALID (23514), the check's own evaluation failing, and the cause that says why was lost.
        LOGGING_LEVEL_ORG_HIBERNATE_ORM_JDBC_ERROR: 'DEBUG',
        TMPDIR: TMP,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  java.stdout?.pipe(log);
  java.stderr?.pipe(log);
  const exited = new Promise<number | null>((done) => java.once('exit', done));
  const url = `http://127.0.0.1:${port}`;
  const stop = async () => {
    if (java.exitCode === null) {
      java.kill('SIGTERM');
      await exited;
    }
  };
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (java.exitCode !== null) break;
    try {
      if ((await fetch(`${url}/api/health`)).ok) return { url, stop };
    } catch {
      // Not listening yet.
    }
    await delay(250);
  }
  await stop();
  throw new Error(`The API did not start; see ${join(BACKEND_DIR, 'api.log')}`);
}
