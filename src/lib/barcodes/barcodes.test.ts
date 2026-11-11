import { describe, expect, it } from 'vitest';
import { glazeWithBarcode, normalizeBarcode, pickBarcode } from './barcodes';
import type { Glaze } from '../api/models';

describe('normalizeBarcode', () => {
  // The same table as backend model/BarcodesTest; change both together ('' = invalid).
  it.each([
    ['4006381333931', '4006381333931'],
    [' 4006381 333931 ', '4006381333931'],
    ['4-006381-333931', '4006381333931'],
    ['036000291452', '0036000291452'],
    ['0036000291452', '0036000291452'],
    ['0 36000 29145 2', '0036000291452'],
    ['96385074', '96385074'],
    ['4006381333932', ''],
    ['036000291453', ''],
    ['96385075', ''],
    ['400638133393', ''],
    ['40063813339310', ''],
    ['4006381333931X', ''],
    ['4006381.333931', ''],
    ['４００６３８１３３３９３１', ''],
    ['   ', ''],
  ])('%j -> %j', (input, expected) => {
    expect(normalizeBarcode(input)).toBe(expected || null);
  });
});

describe('pickBarcode', () => {
  it('takes the first valid retail barcode and ignores other formats and bad check digits', () => {
    expect(
      pickBarcode([
        { format: 'qr_code', rawValue: '4006381333931' },
        { format: 'ean_13', rawValue: '4006381333932' },
        { format: 'upc_a', rawValue: '036000291452' },
        { format: 'ean_8', rawValue: '96385074' },
      ]),
    ).toBe('0036000291452');
    expect(pickBarcode([{ format: 'code_128', rawValue: '96385074' }])).toBeNull();
    expect(pickBarcode([])).toBeNull();
  });
});

describe('glazeWithBarcode', () => {
  it('finds the loaded glaze carrying a normalized barcode', () => {
    const glazes = [
      { id: 'a', barcodes: ['96385074'] },
      { id: 'b', barcodes: ['0036000291452', '4006381333931'] },
    ] as Glaze[];
    expect(glazeWithBarcode(glazes, '4006381333931')?.id).toBe('b');
    expect(glazeWithBarcode(glazes, '0000000000000')).toBeUndefined();
  });
});
