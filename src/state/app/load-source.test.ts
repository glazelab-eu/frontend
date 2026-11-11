import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./load.ts', import.meta.url), 'utf8');

/** The text from the end of the re-ask loop (`touched`) to the end of the patch that shows the loaded listings, its arguments included. */
function loopTail(text: string): string {
  const start = text.indexOf('for (let round = 0; current() && next');
  expect(start, 'the re-ask loop').toBeGreaterThan(-1);
  expect(text.slice(start, text.indexOf('\n', start)), 'the loop asks touched() in its condition').toContain('touched()');
  let depth = 0;
  let index = text.indexOf('{', start);
  for (; index < text.length; index++) {
    if (text[index] === '{') depth++;
    else if (text[index] === '}' && --depth === 0) break;
  }
  // The dispatcher's `loaded` step shows the data (STATE-1b); its arguments run before it, so they belong to the step too.
  const patch = text.indexOf('ctx.step(version, LOADED, {', index);
  expect(patch, 'the patch that shows the listings').toBeGreaterThan(index);
  let end = text.indexOf('(', patch);
  for (depth = 0; end < text.length; end++) {
    if (text[end] === '(') depth++;
    else if (text[end] === ')' && --depth === 0) break;
  }
  return text.slice(index + 1, end + 1);
}

/**
 * The re-ask loop's last `touched()`/`current()` and the patch that shows the data run in one synchronous step (STATE-1a review):
 * any await between them lets a write patch the shown data unseen, and the older answers would then overwrite it (a deleted
 * combination comes back). No test can time a write into that one microtask, so the source says it.
 */
describe('the load', () => {
  it('shows the listings in the same synchronous step as the re-ask loop’s last check', () => {
    const tail = loopTail(source);
    expect(tail).toContain('if (!current() || !next) return;');
    expect(tail).not.toMatch(/\bawait\b|\.then\(|queueMicrotask|setTimeout/);
  });

  it('notices an await between the check and the patch', () => {
    const broken = source.replace('if (!current() || !next) return;', 'if (!current() || !next) return;\n      await Promise.resolve();');
    expect(loopTail(broken)).toMatch(/\bawait\b/);
  });

  it('notices an await in the patch’s own arguments, which run before it', () => {
    const broken = source.replace(
      '        favoriteCounts,\n        ...reachable(),',
      '        favoriteCounts: await Promise.resolve(favoriteCounts),\n        ...reachable(),',
    );
    expect(broken).not.toBe(source);
    expect(loopTail(broken)).toMatch(/\bawait\b/);
  });
});
