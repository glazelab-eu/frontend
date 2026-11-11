import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildId, sourceHash, VERSION_META_NAME, versionLabel, withVersionMeta } from '../../../scripts/build-version';
import { VERSION_META, versionIn } from './update';

describe('build version', () => {
  it.each([
    ['0.1.0', 'a1b2c3d', '0.1.0 (a1b2c3d)'],
    ['0.1.0', '', '0.1.0'],
  ])('labels %s with build %j as %j', (version, build, label) => {
    expect(versionLabel(version, build)).toBe(label);
  });

  it('takes the environment first, then git, then a hash of the sources', () => {
    const git = () => 'f00ba12\n';
    const source = () => 'src 0123456789';
    expect(buildId(' ci-42 ', git, source)).toBe('ci-42');
    expect(buildId('', git, source)).toBe('f00ba12');
    expect(buildId(undefined, git, source)).toBe('f00ba12');
    const noGit = () => {
      throw new Error('not a repository');
    };
    // A Docker build without GLAZELAB_BUILD: two deployments of different sources differ in the footer and the update notice's details.
    expect(buildId(undefined, noGit, source)).toBe('src 0123456789');
    expect(buildId('  ', () => '', source)).toBe('src 0123456789');
  });

  it('hashes the sources, not the build time: the same tree builds the same worker, so a rebuild raises no update notice', () => {
    const root = mkdtempSync(join(tmpdir(), 'glazelab-source-'));
    try {
      mkdirSync(join(root, 'src/lib'), { recursive: true });
      mkdirSync(join(root, 'node_modules'), { recursive: true });
      writeFileSync(join(root, 'index.html'), '<html></html>');
      writeFileSync(join(root, 'package.json'), '{}');
      writeFileSync(join(root, 'src/lib/a.ts'), 'export const a = 1;');
      writeFileSync(join(root, 'node_modules/x.js'), 'x');
      const first = sourceHash(root);
      expect(first).toMatch(/^src [0-9a-f]{10}$/);
      utimesSync(join(root, 'src/lib/a.ts'), new Date(0), new Date(0));
      writeFileSync(join(root, 'node_modules/x.js'), 'y');
      writeFileSync(join(root, 'notes.txt'), 'not an input');
      expect(sourceHash(root)).toBe(first);
      writeFileSync(join(root, 'src/lib/a.ts'), 'export const a = 2;');
      const changed = sourceHash(root);
      expect(changed).not.toBe(first);
      // A file's name is part of the hash, not only its bytes.
      rmSync(join(root, 'src/lib/a.ts'));
      writeFileSync(join(root, 'src/lib/b.ts'), 'export const a = 2;');
      expect(sourceHash(root)).not.toBe(changed);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('writes the label into index.html where the update code reads it', () => {
    expect(VERSION_META_NAME).toBe(VERSION_META);
    const html = withVersionMeta('<html><head><title>x</title></head><body></body></html>', '0.1.0 ("a" & <b>)');
    expect(html).toContain('<meta name="glazelab-version" content="0.1.0 (&quot;a&quot; &amp; &lt;b&gt;)" />');
    expect(versionIn(html)).toBe('0.1.0 ("a" & <b>)');
    expect(() => withVersionMeta('<html></html>', 'x')).toThrow();
  });
});
