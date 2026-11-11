import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = new URL('../../', import.meta.url).pathname;
/** The five loading fields of the store before STATE-1b, as a key with a value; a parameter typed `boolean` or `Promise` of the same name is no write. */
const OLD_KEYS = /\b(loading|syncing|syncProgress|loadFailed|loadFailure)\s*:(?!\s*(boolean|Promise)\b)/;
/**
 * `sync` as a key with a value (`sync: …`, shorthand `{ sync }` also on a line of its own, a quoted computed key), not its type; or a
 * spread of the whole state (`...ctx.read()`), which carries its `sync` and passes the `AppPatch` type (spreads get no excess-property check).
 */
const SYNC_KEY = /\bsync\s*:(?!\s*SyncState\b)|(^|[{,])\s*sync\s*([,}]|$)|\[\s*['"`]sync['"`]\s*\]|\.\.\.\s*(ctx\.)?read\(\)(?![.\w])/;
/** The projection of the old fields (tests assert with it). */
const PROJECTION = 'lib/sync/lifecycle.ts';
/** The store's initial state and the core, whose `update` the dispatcher `step` goes through. */
const SYNC_WRITERS = ['state/app/app-state.ts', 'state/app/app-controller.ts'];

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'generated' ? [] : sources(path);
    return /\.(ts|svelte)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [path] : [];
  });
}

type Source = { name: string; text: string };
const lines = (files: Source[], pattern: RegExp) =>
  files.flatMap(({ name, text }) => text.split('\n').flatMap((line, index) => (pattern.test(line) ? [`${name}:${index + 1}: ${line.trim()}`] : [])));

/** `file:line: text` of every line that writes a loading field or the sync state outside the places allowed to. */
function writers(files: Source[]): string[] {
  return [
    ...lines(
      files.filter(({ name }) => name !== PROJECTION),
      OLD_KEYS,
    ),
    // The store is written in `state/` only (pages get it read-only); `lib/api` has a `sync` request of its own.
    ...lines(
      files.filter(({ name }) => name.startsWith('state/') && !SYNC_WRITERS.includes(name)),
      SYNC_KEY,
    ),
  ];
}

/**
 * STATE-1b: only the sync dispatcher writes the sync state (`AppState.sync`): every module sends an event (`ctx.step`), and `patch` is
 * typed without it (`AppPatch`); this scan also catches a cast or a spread that the type would let through, and the old loading fields
 * coming back.
 */
describe('the sync state', () => {
  const files = sources(SRC).map((path) => ({ name: relative(SRC, path), text: readFileSync(path, 'utf8') }));

  it('is written only through the sync dispatcher, and the old loading fields are gone', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(writers(files)).toEqual([]);
  });

  it('notices a direct write of the sync state or of an old field', () => {
    const load = files.find(({ name }) => name === 'state/app/load.ts')!;
    for (const write of [
      'ctx.patch({ sync: INITIAL_SYNC } as never);',
      'ctx.patch({ sync } as never);',
      'ctx.patch({ syncing: false } as never);',
      // Prettier puts a longer patch on lines of its own.
      "ctx.patch({\n        error: '',\n        sync,\n      } as never);",
      "ctx.patch({ ['sync']: INITIAL_SYNC } as never);",
      // A spread of a whole state compiles without a cast (no excess-property check for spreads) and writes its `sync` back.
      "ctx.patch({ ...ctx.read(), error: '' });",
    ]) {
      const broken = { ...load, text: load.text.replace('ctx.step(version, ENDED);', write) };
      expect(writers([broken]), write).toHaveLength(1);
    }
  });
});
