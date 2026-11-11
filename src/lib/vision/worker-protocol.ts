/** Messages between `client.ts` and `vision-worker.ts`; buffers are transferred, never copied. */
export type ToWorker = { type: 'init'; wasm: ArrayBuffer; model: ArrayBuffer } | { type: 'run'; id: number; pixels: Float32Array; size: number };

export type FromWorker = { type: 'ready' } | { type: 'failed'; id?: number; message: string } | { type: 'result'; id: number; embedding: Float32Array };
