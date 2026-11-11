import type { Glaze } from '../api/models';

/**
 * Retail barcodes of glaze packaging, normalized exactly like the backend's model/Barcodes (shared
 * test table): EAN-13, UPC-A and EAN-8 with a valid GS1 check digit, spaces and hyphens ignored, and
 * UPC-A stored as its EAN-13 form (a leading 0). A barcode belongs to at most one glaze.
 */
export const maxBarcodesPerGlaze = 10;

/** The formats a scan accepts; others (QR codes, Code 128, ...) are ignored. */
export const retailFormats = ['ean_13', 'upc_a', 'ean_8'] as const;

function checkDigitValid(digits: string): boolean {
  let sum = 0;
  for (let i = digits.length - 2, weight = 3; i >= 0; i--, weight = 4 - weight) {
    sum += Number(digits[i]) * weight;
  }
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1]);
}

/** The digit counts a barcode can have: EAN-8, UPC-A and EAN-13 (the shelf's `#/stock/<barcode>` route takes the same). */
export const BARCODE_DIGITS = /^(?:[0-9]{8}|[0-9]{12,13})$/;

/** The stored form (13 or 8 digits), or null when the value is not a valid barcode. */
export function normalizeBarcode(value: string): string | null {
  let digits = value.replace(/[\s-]/g, '');
  if (!BARCODE_DIGITS.test(digits)) return null;
  if (digits.length === 12) digits = `0${digits}`;
  return checkDigitValid(digits) ? digits : null;
}

export interface DetectedCode {
  rawValue: string;
  format: string;
}

/** The first detected retail barcode with a valid check digit, normalized; null when none. */
export function pickBarcode(codes: readonly DetectedCode[]): string | null {
  for (const code of codes) {
    if (!(retailFormats as readonly string[]).includes(code.format)) continue;
    const barcode = normalizeBarcode(code.rawValue);
    if (barcode) return barcode;
  }
  return null;
}

/** The loaded glaze carrying a normalized barcode, if any. */
export function glazeWithBarcode(glazes: readonly Glaze[], barcode: string): Glaze | undefined {
  return glazes.find((glaze) => glaze.barcodes.includes(barcode));
}
