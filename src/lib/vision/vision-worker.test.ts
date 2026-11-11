import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ created: [] as Uint8Array[], lengthAtCreate: [] as number[] }));

vi.mock('onnxruntime-web/wasm', () => ({
  env: { wasm: {} },
  Tensor: class {
    constructor(
      public type: string,
      public data: Float32Array,
      public dims: number[],
    ) {}
  },
  InferenceSession: {
    create: async (bytes: Uint8Array) => {
      runtime.created.push(bytes);
      runtime.lengthAtCreate.push(bytes.byteLength);
      return {
        inputNames: ['in'],
        outputNames: ['out'],
        run: async () => ({ out: { data: new Float32Array([1, 2]) } }),
      };
    },
  },
}));

const posted: unknown[] = [];

async function loadWorker() {
  vi.resetModules();
  Object.assign(globalThis, { self: globalThis, postMessage: (message: unknown) => posted.push(message) });
  await import('./vision-worker');
  return (globalThis as unknown as { onmessage: (event: { data: unknown }) => Promise<void> }).onmessage;
}

describe('vision worker buffers (33-4)', () => {
  beforeEach(() => {
    posted.length = 0;
    runtime.created.length = 0;
    runtime.lengthAtCreate.length = 0;
  });

  it('detaches the model and runtime buffers once the session exists, and the session still runs', async () => {
    const onmessage = await loadWorker();
    const wasm = new ArrayBuffer(16);
    const model = new ArrayBuffer(32);
    await onmessage({ data: { type: 'init', wasm, model } });
    expect(posted).toEqual([{ type: 'ready' }]);
    expect(runtime.lengthAtCreate).toEqual([32]);
    expect(wasm.byteLength).toBe(0);
    expect(model.byteLength).toBe(0);
    await onmessage({ data: { type: 'run', id: 1, pixels: new Float32Array(12), size: 2 } });
    expect(posted[1]).toMatchObject({ type: 'result', id: 1, embedding: new Float32Array([1, 2]) });
  });

  it('keeps working on an engine without ArrayBuffer.transfer', async () => {
    const onmessage = await loadWorker();
    const original = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'transfer')!;
    Reflect.deleteProperty(ArrayBuffer.prototype, 'transfer');
    try {
      const model = new ArrayBuffer(8);
      await onmessage({ data: { type: 'init', wasm: new ArrayBuffer(4), model } });
      expect(posted).toEqual([{ type: 'ready' }]);
      expect(model.byteLength).toBe(8);
    } finally {
      Object.defineProperty(ArrayBuffer.prototype, 'transfer', original);
    }
  });
});
