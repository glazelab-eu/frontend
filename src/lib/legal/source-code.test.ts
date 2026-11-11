import { describe, expect, it } from 'vitest';
import { sourceHref, THIRD_PARTY_HREF } from './source-code';

describe('sourceHref', () => {
  it('hides the link while the URL is unset or not yet known', () => {
    for (const url of [undefined, null, '']) expect(sourceHref(url)).toBeNull();
  });

  it('links only to an absolute http or https URL', () => {
    expect(sourceHref('https://code.example.test/glazelab')).toBe('https://code.example.test/glazelab');
    expect(sourceHref('http://code.example.test')).toBe('http://code.example.test/');
    for (const url of ['javascript:alert(1)', 'data:text/html,x', '/relative', 'code.example.test', 'mailto:a@example.test'])
      expect(sourceHref(url)).toBeNull();
  });

  it('points at the notices file at the root of the build', () => {
    expect(THIRD_PARTY_HREF).toBe('/THIRD-PARTY-LICENSES.txt');
  });
});
