/// <reference types="node" />
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

/** The package version, with the build in parentheses when there is one: "0.1.0 (a1b2c3d)". */
export function versionLabel(version: string, build: string): string {
  return build ? `${version} (${build})` : version;
}

/**
 * What tells one build from the next without a manual bump: `GLAZELAB_BUILD` (the Docker build argument; the image's context has no git
 * history), else the short hash of the frontend's HEAD, else a hash of the build's sources (a Docker build without the argument, a source
 * archive). Never the build time: the label is in the bundle and in `index.html`, so a label that changed on every run would give every
 * rebuild of the same sources a new service worker and every open app an update notice.
 */
export function buildId(env: string | undefined = process.env.GLAZELAB_BUILD, git: () => string = gitHead, source: () => string = sourceHash): string {
  const given = env?.trim();
  if (given) return given;
  try {
    const head = git().trim();
    if (head) return head;
  } catch {
    /* No git checkout: the sources' hash below. */
  }
  return source();
}

/** What a build reads from the frontend's root (everything else there, `node_modules` and `e2e` included, leaves the label alone). */
const SOURCES = ['index.html', 'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'public', 'scripts', 'src'];

/** "src " and 10 hex digits of a SHA-256 over the sources' paths and bytes, in a fixed order (pure for a given tree). */
export function sourceHash(root: string = fileURLToPath(new URL('..', import.meta.url))): string {
  const hash = createHash('sha256');
  const add = (path: string) => {
    const full = `${root}/${path}`;
    if (!existsSync(full)) return;
    if (statSync(full).isDirectory()) {
      for (const name of readdirSync(full).sort()) add(`${path}/${name}`);
      return;
    }
    hash.update(`${path}\0`).update(readFileSync(full)).update('\0');
  };
  for (const path of SOURCES) add(path);
  return `src ${hash.digest('hex').slice(0, 10)}`;
}

function gitHead(): string {
  return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: new URL('..', import.meta.url), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

/** The label the footer shows; `vite.config.ts` defines it as `__APP_VERSION__`. */
export function appVersion(): string {
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  return versionLabel(version, buildId());
}

/** The `<meta name>` of the label in `index.html`; `lib/pwa/update.ts` (`VERSION_META`) reads it from a waiting worker's precache. */
export const VERSION_META_NAME = 'glazelab-version';

/** `index.html` with the build label in a meta tag before `</head>`. */
export function withVersionMeta(html: string, label: string): string {
  const content = label.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  if (!html.includes('</head>')) throw new Error('index.html has no </head> for the version meta tag');
  return html.replace('</head>', `<meta name="${VERSION_META_NAME}" content="${content}" />\n  </head>`);
}

/**
 * Writes the label into `index.html`, so the precached copy tells which build a waiting worker serves (the update notice's footer line);
 * the label also changes the precached `index.html`'s revision with every new label (the bundle carries it as `__APP_VERSION__` anyway).
 */
export function versionMeta(label: string): Plugin {
  return { name: 'version-meta', transformIndexHtml: (html) => withVersionMeta(html, label) };
}
