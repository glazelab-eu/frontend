import { describe, expect, it } from 'vitest';
import { hashUrlForPath } from './path-to-hash';

describe('path to hash', () => {
  it.each([
    ['/', '', '', null],
    ['/', '', '#', null],
    ['/', '?x=1', '', null],
    ['/clubs', '', '#/stock', null],
    ['/clubs', '', '#/', null],
    ['/clubs', '', '', '/#/clubs'],
    ['/clubs', '', '#', '/#/clubs'],
    ['/clubs/', '', '', '/#/clubs'],
    ['/clubs//', '', '', '/#/clubs'],
    ['/stock', '?glaze=g1', '', '/#/stock?glaze=g1'],
    ['/studio', '', '', '/#/studio'],
    ['/account', '', '', '/#/account'],
    ['/nothing-here', '', '', '/#/nothing-here'],
    ['/glazes/abc', '', '', '/#/glazes/abc'],
    ['/clubs%2Fx%20y', '', '', '/#/clubs%2Fx%20y'],
    ['/start', '', '', '/#/'],
    ['/start/', '', '', '/#/'],
    ['/Home', '', '', '/#/'],
    ['/index', '?type=glazes', '', '/#/?type=glazes'],
    ['/index.html', '', '', '/#/'],
    ['/start/more', '', '', '/#/start/more'],
  ])('%s %s %s', (pathname, search, hash, expected) => {
    expect(hashUrlForPath(pathname, search, hash)).toBe(expected);
  });
});
