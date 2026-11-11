import type { Glaze } from '../api/models';
import { maxBarcodesPerGlaze } from './barcodes';

/** What "Add a glaze" opens first: the barcode scanner where a camera is likely at hand, else the dialog. */
export type AddStart = 'scanner' | 'dialog';

/**
 * Phones and tablets (a coarse primary pointer) with camera support start with the scanner; a desktop or a
 * browser without `getUserMedia` (also an insecure page) opens the dialog directly.
 */
export function addStart(coarsePointer: boolean, cameraSupport: boolean): AddStart {
  return coarsePointer && cameraSupport ? 'scanner' : 'dialog';
}

/** Reads the browser's pointer and camera support. */
export function addStartHere(): AddStart {
  const coarse = globalThis.matchMedia?.('(pointer: coarse)').matches ?? false;
  return addStart(coarse, !!globalThis.navigator?.mediaDevices?.getUserMedia);
}

/**
 * Whether the scanned barcode can be added to this existing glaze: a scan opened the dialog, the glaze does not
 * carry it yet and has room for one more. Never replaces a barcode.
 */
export function canTakeBarcode(glaze: Pick<Glaze, 'barcodes'>, barcode: string): boolean {
  return !!barcode && !glaze.barcodes.includes(barcode) && glaze.barcodes.length < maxBarcodesPerGlaze;
}
