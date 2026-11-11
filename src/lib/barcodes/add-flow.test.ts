import { describe, expect, it } from 'vitest';
import { addStart, canTakeBarcode } from './add-flow';

describe('addStart', () => {
  it.each([
    [true, true, 'scanner'],
    [true, false, 'dialog'],
    [false, true, 'dialog'],
    [false, false, 'dialog'],
  ] as const)('coarse %s, camera %s -> %s', (coarse, camera, expected) => {
    expect(addStart(coarse, camera)).toBe(expected);
  });
});

describe('canTakeBarcode', () => {
  const codes = (count: number) => Array.from({ length: count }, (_, index) => `code${index}`);
  it('needs a scanned barcode the glaze lacks and room for one more', () => {
    expect(canTakeBarcode({ barcodes: [] }, '4006381333931')).toBe(true);
    expect(canTakeBarcode({ barcodes: codes(9) }, '4006381333931')).toBe(true);
  });
  it('refuses without a scan, a barcode already there or a full glaze', () => {
    expect(canTakeBarcode({ barcodes: [] }, '')).toBe(false);
    expect(canTakeBarcode({ barcodes: ['4006381333931'] }, '4006381333931')).toBe(false);
    expect(canTakeBarcode({ barcodes: codes(10) }, '4006381333931')).toBe(false);
  });
});
