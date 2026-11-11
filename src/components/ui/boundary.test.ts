/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `components/ui` is the generic UI library (frontend guide "UI library"): a file there imports only `svelte` and its own
 * folder (pure helpers live with it), never i18n, app state, routes, the API or its models, glaze terms or the PWA layer;
 * every visible string comes as a prop or from `labels.ts`.
 */
const root = new URL('./', import.meta.url);
const files = (readdirSync(root, { recursive: true, encoding: 'utf8' }) as string[])
  .map((path) => path.split('\\').join('/'))
  .filter((path) => /\.(svelte|ts)$/.test(path) && !/\.test\.ts$/.test(path))
  .sort();

/** Every module a file names: static imports and re-exports (also type-only and side-effect ones) and dynamic imports. */
function specifiers(source: string): string[] {
  const patterns = [/\b(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g, /\bimport\s*['"]([^'"]+)['"]/g, /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g];
  return patterns.flatMap((pattern) => [...source.matchAll(pattern)].map((match) => match[1]));
}

/** Whether a file at `path` (relative to `components/ui`) may import `specifier`: `svelte` and the folder itself only. */
function allowedImport(path: string, specifier: string): boolean {
  if (specifier === 'svelte' || specifier.startsWith('svelte/')) return true;
  if (!specifier.startsWith('.')) return false;
  const target = posix.normalize(posix.join(posix.dirname(path), specifier));
  return !target.startsWith('../') && target !== '..';
}

const forbidden = (path: string) => specifiers(readFileSync(new URL(path, root), 'utf8')).filter((specifier) => !allowedImport(path, specifier));
const violators: Record<string, string[]> = Object.fromEntries(files.map((path) => [path, forbidden(path)] as const).filter(([, imports]) => imports.length));

describe('components/ui boundary', () => {
  it('reads the imports of every kind', () => {
    const source = `import { t } from '../../lib/i18n';\nimport type { Glaze } from '../../lib/api/models';\nimport '../../style.css';\nexport { x } from '../../lib/x';\nconst chunk = import('../../lib/y');\nimport Icon from './Icon.svelte';\nimport {\n  tick,\n} from 'svelte';`;
    expect(specifiers(source).sort()).toEqual(
      ['../../lib/api/models', '../../lib/i18n', '../../lib/x', '../../lib/y', '../../style.css', './Icon.svelte', 'svelte'].sort(),
    );
    // The scan sees the library: a pattern or a path that stopped matching would pass every rule below.
    expect(files).toContain('ModalShell.svelte');
    expect(files).toContain('Icon.svelte');
  });

  it('allows svelte and the folder itself, nothing else', () => {
    expect(allowedImport('ModalShell.svelte', 'svelte')).toBe(true);
    expect(allowedImport('ModalShell.svelte', 'svelte/store')).toBe(true);
    expect(allowedImport('ModalShell.svelte', './Icon.svelte')).toBe(true);
    expect(allowedImport('menu/Menu.svelte', '../Icon.svelte')).toBe(true);
    expect(allowedImport('ModalShell.svelte', '../../lib/i18n')).toBe(false);
    expect(allowedImport('ModalShell.svelte', '../layout/AppNav.svelte')).toBe(false);
    expect(allowedImport('ModalShell.svelte', 'svelte-i18n')).toBe(false);
    expect(allowedImport('ModalShell.svelte', '..')).toBe(false);
  });

  it('imports only svelte and its own folder, with no exceptions', () => {
    expect(Object.entries(violators).map(([path, imports]) => `${path}: ${imports.join(', ')}`)).toEqual([]);
  });
});
