import { describe, expect, it, vi } from 'vitest';
import {
  CameraError,
  ScannerLoadError,
  ScannerUnsupportedError,
  scanningImpossible,
  lockdownModeLikely,
  cameraProblem,
  loadDetector,
  openCamera,
  stopCamera,
  repeatBarcode,
  type RepeatBarcode,
  watchForBarcode,
  pickQr,
  qrFormats,
  type Detector,
} from './scanner';

const detector = (results: { rawValue: string; format: string }[][]): Detector => {
  let call = 0;
  return { detect: vi.fn(async () => results[Math.min(call++, results.length - 1)]) };
};

function nativeDetector(supported: string[]) {
  const created: { formats: string[] }[] = [];
  class Native {
    static getSupportedFormats = async () => supported;
    constructor(options: { formats: string[] }) {
      created.push(options);
    }
    detect = async () => [];
  }
  return { Native, created };
}

describe('loadDetector', () => {
  it('uses the native detector for the retail formats it supports', async () => {
    const { Native, created } = nativeDetector(['qr_code', 'ean_13', 'ean_8']);
    const fallback = vi.fn();
    expect(await loadDetector(Native, fallback)).toBeInstanceOf(Native);
    expect(created).toEqual([{ formats: ['ean_13', 'ean_8'] }]);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('loads the fallback without a native detector or one without retail formats', async () => {
    const fake = detector([[]]);
    for (const native of [undefined, nativeDetector(['qr_code']).Native]) {
      const createDetector = vi.fn(async () => fake);
      expect(await loadDetector(native, async () => ({ createDetector }))).toBe(fake);
      expect(createDetector).toHaveBeenCalledWith(['ean_13', 'upc_a', 'ean_8']);
    }
  });

  it('reports a failed chunk import or wasm download as a load error (offer a reload)', async () => {
    const chunkGone = () => Promise.reject(new TypeError('Failed to fetch dynamically imported module'));
    await expect(loadDetector(undefined, chunkGone)).rejects.toBeInstanceOf(ScannerLoadError);
    const wasmGone = async () => ({ createDetector: () => Promise.reject(new Error('wasm')) });
    await expect(loadDetector(undefined, wasmGone)).rejects.toBeInstanceOf(ScannerLoadError);
  });
});

describe('without WebAssembly', () => {
  it('refuses the fallback with an unsupported error and never imports it', async () => {
    const fallback = vi.fn();
    await expect(loadDetector(undefined, fallback, undefined, null)).rejects.toBeInstanceOf(ScannerUnsupportedError);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('scanning is impossible only without a native detector and without WebAssembly', () => {
    expect(scanningImpossible(null, null)).toBe(true);
    expect(scanningImpossible(class {}, null)).toBe(false);
    expect(scanningImpossible(null, {})).toBe(false);
  });

  it('guesses Lockdown Mode only on Apple touch devices', () => {
    expect(lockdownModeLikely('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 5)).toBe(true);
    expect(lockdownModeLikely('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe(true);
    expect(lockdownModeLikely('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0)).toBe(false);
    expect(lockdownModeLikely('Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0', 0)).toBe(false);
  });
});

describe('camera', () => {
  it('maps getUserMedia failures to the problems shown', () => {
    expect(cameraProblem({ name: 'NotAllowedError' })).toBe('denied');
    expect(cameraProblem({ name: 'SecurityError' })).toBe('denied');
    expect(cameraProblem({ name: 'NotFoundError' })).toBe('missing');
    expect(cameraProblem({ name: 'OverconstrainedError' })).toBe('missing');
    expect(cameraProblem({ name: 'NotReadableError' })).toBe('failed');
    expect(cameraProblem(null)).toBe('failed');
  });

  it('needs a secure context and a browser with camera support', async () => {
    const getUserMedia = vi.fn();
    await expect(openCamera({ getUserMedia }, false)).rejects.toEqual(new CameraError('insecure'));
    await expect(openCamera(undefined, true)).rejects.toEqual(new CameraError('unsupported'));
    expect(getUserMedia).not.toHaveBeenCalled();
    const denied = vi.fn(() => Promise.reject(Object.assign(new Error(), { name: 'NotAllowedError' })));
    await expect(openCamera({ getUserMedia: denied }, true)).rejects.toMatchObject({
      problem: 'denied',
    });
    expect(denied).toHaveBeenCalledWith({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
  });

  it('stops every track of the stream', () => {
    const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
    stopCamera({ getTracks: () => tracks } as unknown as MediaStream);
    stopCamera(null);
    for (const track of tracks) expect(track.stop).toHaveBeenCalledOnce();
  });
});

describe('watchForBarcode', () => {
  const video = (readyState = 4) => ({ readyState }) as HTMLVideoElement;

  it('skips frames without a valid retail barcode and frames that fail', async () => {
    const fake = detector([
      [],
      [{ format: 'qr_code', rawValue: 'https://example.test' }],
      [{ format: 'ean_13', rawValue: '4006381333932' }],
      [{ format: 'upc_a', rawValue: '036000291452' }],
    ]);
    const detect = fake.detect as ReturnType<typeof vi.fn>;
    detect.mockImplementationOnce(() => Promise.reject(new Error('frame')));
    const found = await watchForBarcode(fake, video(), new AbortController().signal, 0);
    expect(found).toBe('0036000291452');
    expect(detect).toHaveBeenCalledTimes(5);
  });

  it('passes decoded empty frames to the repeat gate, but skips detector failures', async () => {
    const fake = detector([[], [{ format: 'ean_8', rawValue: '96385074' }]]);
    const detect = fake.detect as ReturnType<typeof vi.fn>;
    detect.mockRejectedValueOnce(new Error('unreadable frame'));
    const accept = vi.fn((code: string | null) => !!code);
    expect(await watchForBarcode(fake, video(), new AbortController().signal, 0, accept)).toBe('96385074');
    expect(accept.mock.calls).toEqual([[null], ['96385074']]);
  });

  it.each(['barcode', 'empty', 'failed'] as const)(
    'pauses after a %s frame finishes during manual holding, then scans a fresh frame on release',
    async (frame) => {
      vi.useFakeTimers();
      try {
        const controller = new AbortController();
        let finishFrame!: (codes: { format: string; rawValue: string }[]) => void;
        let failFrame!: (error: Error) => void;
        const pending = new Promise<{ format: string; rawValue: string }[]>((resolve, reject) => {
          finishFrame = resolve;
          failFrame = reject;
        });
        const detect = vi
          .fn()
          .mockReturnValueOnce(pending)
          .mockResolvedValue([{ format: 'ean_8', rawValue: '96385074' }]);
        let holding = false;
        let release!: () => void;
        const waitUntilReady = () =>
          !holding
            ? Promise.resolve()
            : new Promise<void>((resolve) => {
                release = resolve;
                controller.signal.addEventListener('abort', () => resolve(), { once: true });
              });
        const accept = vi.fn((code: string | null) => !holding && !!code);
        const watching = watchForBarcode({ detect }, video(), controller.signal, 150, accept, waitUntilReady);
        let emitted = false;
        void watching.then(() => {
          emitted = true;
        });
        await vi.advanceTimersByTimeAsync(0);
        expect(detect).toHaveBeenCalledOnce();
        // Manual submission opens the sheet while the detector still owns its first frame.
        holding = true;
        if (frame === 'failed') failFrame(new Error('unreadable'));
        else finishFrame(frame === 'empty' ? [] : [{ format: 'ean_13', rawValue: '4006381333931' }]);
        await vi.advanceTimersByTimeAsync(900);
        expect(detect).toHaveBeenCalledOnce();
        expect(emitted).toBe(false);
        holding = false;
        release();
        await vi.advanceTimersByTimeAsync(150);
        expect(await watching).toBe('96385074');
        expect(detect).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it('aborts a held watcher without decoding another frame or emitting the in-flight result', async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      let holding = false;
      let finishFrame!: (codes: { format: string; rawValue: string }[]) => void;
      const detect = vi.fn(
        () =>
          new Promise<{ format: string; rawValue: string }[]>((resolve) => {
            finishFrame = resolve;
          }),
      );
      const waitUntilReady = () =>
        !holding
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              controller.signal.addEventListener('abort', () => resolve(), { once: true });
            });
      const watching = watchForBarcode({ detect }, video(), controller.signal, 150, (code) => !holding && !!code, waitUntilReady);
      await vi.advanceTimersByTimeAsync(0);
      holding = true;
      finishFrame([{ format: 'ean_13', rawValue: '4006381333931' }]);
      await vi.advanceTimersByTimeAsync(900);
      expect(detect).toHaveBeenCalledOnce();
      controller.abort();
      expect(await watching).toBeNull();
      expect(detect).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits for video frames and stops with null when aborted', async () => {
    const fake = detector([[{ format: 'ean_8', rawValue: '96385074' }]]);
    const controller = new AbortController();
    const watching = watchForBarcode(fake, video(0), controller.signal, 1);
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    expect(await watching).toBeNull();
    expect(fake.detect).not.toHaveBeenCalled();
  });
});

describe('repeatBarcode', () => {
  it('ignores the same jar for any duration, resetting a brief absence when it reappears', () => {
    vi.useFakeTimers();
    try {
      let state: RepeatBarcode = { code: '4006381333931', absentSince: null };
      vi.advanceTimersByTime(60_000);
      state = repeatBarcode(state, state.code, Date.now());
      expect(state).toEqual({ code: '4006381333931', absentSince: null });
      state = repeatBarcode(state, null, Date.now());
      vi.advanceTimersByTime(599);
      state = repeatBarcode(state, null, Date.now());
      expect(state.code).toBe('4006381333931');
      state = repeatBarcode(state, state.code, Date.now());
      expect(state.absentSince).toBeNull();
      state = repeatBarcode(state, null, Date.now());
      vi.advanceTimersByTime(600);
      state = repeatBarcode(state, null, Date.now());
      expect(state.code).toBe('');
      expect(repeatBarcode(state, '4006381333931', Date.now()).code).toBe('4006381333931');
    } finally {
      vi.useRealTimers();
    }
  });

  it('accepts a different jar immediately, then allows the earlier jar again', () => {
    const first = { code: '4006381333931', absentSince: null };
    const second = repeatBarcode(first, '5901234123457', 0);
    expect(second).toEqual({ code: '5901234123457', absentSince: null });
    expect(repeatBarcode(second, first.code, 1)).toEqual(first);
  });
});

describe('the QR scan', () => {
  it('asks for QR codes only, from the native detector or the fallback', async () => {
    const { Native, created } = nativeDetector(['qr_code', 'ean_13']);
    await loadDetector(Native, vi.fn(), qrFormats);
    expect(created).toEqual([{ formats: ['qr_code'] }]);
    const createDetector = vi.fn(async () => detector([]));
    await loadDetector(undefined, async () => ({ createDetector }), qrFormats);
    expect(createDetector).toHaveBeenCalledWith(['qr_code']);
  });

  it('picks the raw text of a QR code and ignores barcodes and empty codes', () => {
    expect(pickQr([{ rawValue: '4006381333931', format: 'ean_13' }])).toBeNull();
    expect(pickQr([{ rawValue: '', format: 'qr_code' }])).toBeNull();
    expect(
      pickQr([
        { rawValue: '4006381333931', format: 'ean_13' },
        { rawValue: ' https://x/#/buddy/y ', format: 'qr_code' },
      ]),
    ).toBe(' https://x/#/buddy/y ');
  });

  it('takes the first valid code of a frame, and the first code when none is valid', () => {
    const codes = [
      { rawValue: 'refused', format: 'qr_code' },
      { rawValue: '4006381333931', format: 'ean_13' },
      { rawValue: 'good', format: 'qr_code' },
      { rawValue: 'good too', format: 'qr_code' },
    ];
    expect(pickQr(codes, (text) => text.startsWith('good'))).toBe('good');
    expect(pickQr(codes, () => false)).toBe('refused');
    expect(pickQr(codes)).toBe('refused');
    expect(pickQr(codes, (text) => text === '4006381333931')).toBe('refused');
  });

  it('reads frames with the given picker', async () => {
    const video = { readyState: 4 } as HTMLVideoElement;
    const seen = await watchForBarcode(
      detector([[{ rawValue: 'link', format: 'qr_code' }]]),
      video,
      new AbortController().signal,
      1,
      undefined,
      undefined,
      pickQr,
    );
    expect(seen).toBe('link');
  });
});
