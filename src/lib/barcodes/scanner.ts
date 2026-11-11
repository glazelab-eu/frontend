import { pickBarcode, retailFormats, type DetectedCode } from './barcodes';

/** What both the native BarcodeDetector and the ZXing fallback offer. */
export interface Detector {
  detect(source: HTMLVideoElement): Promise<DetectedCode[]>;
}

interface NativeDetector {
  new (options: { formats: string[] }): Detector;
  getSupportedFormats(): Promise<string[]>;
}

type Fallback = () => Promise<{ createDetector(formats: string[]): Promise<Detector> }>;

/** The fallback chunk could not be loaded (offline before first use, or an outdated app version). */
export class ScannerLoadError extends Error {}

/** Why the camera cannot be used; each has its own translated message, and typing still works. */
export type CameraProblem = 'insecure' | 'unsupported' | 'denied' | 'missing' | 'failed';

/** The device cannot decode barcodes at all: no native BarcodeDetector and no WebAssembly for the ZXing fallback. */
export class ScannerUnsupportedError extends Error {}

/**
 * True where scanning cannot work (an iPhone in Lockdown Mode or a hardened browser switches WebAssembly off): checked before the
 * camera opens, so the camera light never comes on for nothing and the failing wasm download is never attempted or reported.
 */
export function scanningImpossible(
  native: unknown = (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector,
  wasm: unknown = (globalThis as { WebAssembly?: unknown }).WebAssembly,
): boolean {
  return !native && !wasm;
}

/** A guess for the hint only (Safari has no way to ask for Lockdown Mode): WebAssembly is missing on an Apple touch device. */
export function lockdownModeLikely(userAgent = globalThis.navigator?.userAgent ?? '', touchPoints = globalThis.navigator?.maxTouchPoints ?? 0): boolean {
  return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && touchPoints > 1);
}
export class CameraError extends Error {
  constructor(public problem: CameraProblem) {
    super(problem);
  }
}

/**
 * The native BarcodeDetector when it reads retail barcodes (Chrome on Android/macOS/ChromeOS), else
 * the lazily imported ZXing fallback. A failed import becomes ScannerLoadError (offer a reload).
 */
export async function loadDetector(
  native = (globalThis as { BarcodeDetector?: NativeDetector }).BarcodeDetector,
  fallback: Fallback = () => import('./barcode-fallback'),
  wanted: readonly string[] = retailFormats,
  wasm: unknown = (globalThis as { WebAssembly?: unknown }).WebAssembly,
): Promise<Detector> {
  if (native) {
    try {
      const supported = await native.getSupportedFormats();
      const formats = wanted.filter((format) => supported.includes(format));
      if (formats.length) return new native({ formats });
    } catch {
      // Use the fallback below.
    }
  }
  if (!wasm) throw new ScannerUnsupportedError();
  try {
    const module = await fallback();
    return await module.createDetector([...wanted]);
  } catch {
    throw new ScannerLoadError();
  }
}

/** The format of the QR scan (an invite or buddy link): the one code the link scanner reads. */
export const qrFormats = ['qr_code'] as const;

/**
 * The text of the QR code to hand over from a frame, raw (the caller decides what it may open); null when none. With
 * several codes in one frame the first one `isValid` accepts wins, so a refused code found first never hides a valid
 * one beside it; when none is valid the first code is returned, so the caller can refuse it.
 */
export function pickQr(codes: readonly DetectedCode[], isValid: (text: string) => boolean = () => true): string | null {
  const texts = codes.filter((code) => code.format === 'qr_code' && code.rawValue).map((code) => code.rawValue);
  return texts.find(isValid) ?? texts[0] ?? null;
}

/** Maps a getUserMedia failure to the problem shown to the user. */
export function cameraProblem(error: unknown): CameraProblem {
  const name = (error as { name?: unknown } | null)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') return 'missing';
  return 'failed';
}

/**
 * Opens the back camera. Browsers offer cameras only in secure contexts (HTTPS or localhost).
 * Throws CameraError; the caller must stop the stream's tracks when done (see stopCamera).
 */
export async function openCamera(
  media: Pick<MediaDevices, 'getUserMedia'> | undefined = globalThis.navigator?.mediaDevices,
  secure = globalThis.isSecureContext,
): Promise<MediaStream> {
  if (!secure) throw new CameraError('insecure');
  if (!media?.getUserMedia) throw new CameraError('unsupported');
  try {
    return await media.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
  } catch (error) {
    throw new CameraError(cameraProblem(error));
  }
}

export function stopCamera(stream: MediaStream | null | undefined) {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

/** Pause between two detected frames. */
export const SCAN_INTERVAL_MS = 150;
/** How long a handled jar must be absent from decoded frames before it may be scanned again. */
const REPEAT_ABSENT_MS = 600;

/**
 * Reads frames until a valid retail barcode appears (normalized) or the signal aborts (null).
 * Frames that fail to decode are skipped; at most one detection runs at a time.
 * waitUntilReady pauses between frames (including empty/failed ones) and must resolve on abort.
 * accept may reject an in-flight frame made stale while detection was pending.
 */
export async function watchForBarcode(
  detector: Detector,
  video: HTMLVideoElement,
  signal: AbortSignal,
  interval = SCAN_INTERVAL_MS,
  accept: (barcode: string | null) => boolean = (barcode) => barcode !== null,
  waitUntilReady?: () => Promise<void>,
  pick: (codes: readonly DetectedCode[]) => string | null = pickBarcode,
): Promise<string | null> {
  while (!signal.aborted) {
    await waitUntilReady?.();
    if (signal.aborted) return null;
    if (video.readyState >= 2) {
      try {
        const barcode = pick(await detector.detect(video));
        if (!signal.aborted && accept(barcode) && barcode) return barcode;
      } catch {
        // A frame that cannot be read; try the next one.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  return null;
}

/** A handled jar stays blocked until absent for `REPEAT_ABSENT_MS`, or another valid code appears. */
export interface RepeatBarcode {
  code: string;
  absentSince: number | null;
}

/** Pure frame transition: failed detections must not be passed as empty frames. */
export function repeatBarcode(previous: RepeatBarcode, barcode: string | null, now: number): RepeatBarcode {
  if (barcode) {
    return { code: barcode, absentSince: null };
  }
  if (!previous.code) return previous;
  const absentSince = previous.absentSince ?? now;
  return now - absentSince >= REPEAT_ABSENT_MS ? { code: '', absentSince: null } : { ...previous, absentSince };
}
