import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { BACKEND_DIR, JAR, OUTPUT } from './paths';

const run = promisify(execFile);

/**
 * The H2 jar the API ships with: unpacked once per worker from the API's own JAR (`unzip`), else the local Maven repository's.
 * Workers share the folder, so the jar is unpacked into a folder of its own and moved into place: a worker never reads a jar that
 * another worker is still writing (the shell then fails with `ClassNotFoundException`).
 */
let h2Path: Promise<string> | undefined;
const h2Jar = () => (h2Path ??= findH2Jar());

async function findH2Jar(): Promise<string> {
  const folder = join(OUTPUT, 'tools');
  await mkdir(folder, { recursive: true });
  const named = (listing: string) => listing.split('\n').find((name) => /^h2-[\d.]+\.jar$/.test(name));
  const existing = named((await run('ls', [folder])).stdout);
  if (existing) return join(folder, existing);
  try {
    const scratch = await mkdtemp(join(folder, 'unzip-'));
    await run('unzip', ['-o', '-j', '-q', JAR, 'BOOT-INF/lib/h2-*.jar', '-d', scratch]);
    const found = named((await run('ls', [scratch])).stdout);
    if (found) {
      await rename(join(scratch, found), join(folder, found));
      await rm(scratch, { recursive: true, force: true });
      return join(folder, found);
    }
  } catch {
    // Fall through to the Maven repository.
  }
  const maven = join(homedir(), '.m2', 'repository', 'com', 'h2database', 'h2');
  const { stdout } = await run('find', [maven, '-name', 'h2-*.jar', '-not', '-name', '*sources*']);
  const jar = stdout.split('\n').find(Boolean);
  if (!jar || !existsSync(jar)) throw new Error('No H2 jar found for the site-admin helper');
  return jar;
}

/**
 * Makes an account a site admin the only way there is (SQL on the database: no endpoint grants the role), through the H2 shell
 * on the suite's own database, which the API opened with AUTO_SERVER. The flag applies to the account's next request.
 */
export async function grantSiteAdmin(email: string): Promise<void> {
  const url = `jdbc:h2:file:${join(BACKEND_DIR, 'data', 'glazelab')};AUTO_SERVER=TRUE`;
  const sql = `UPDATE app_user SET site_admin = TRUE WHERE lower(email) = lower('${email.replace(/'/g, "''")}')`;
  await run('java', ['-cp', await h2Jar(), 'org.h2.tools.Shell', '-url', url, '-user', 'sa', '-password', '', '-sql', sql]);
}
