/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/wasm';
import type { FromWorker, ToWorker } from './worker-protocol';

/**
 * The image encoder of the photo suggestions (33-1) on ONNX Runtime Web's WebAssembly build, in a worker of its own so
 * the page never waits for it. One thread (threads need cross-origin isolation, which the app does not use) and the
 * runtime's own worker proxy off: this already IS the worker. The files arrive as buffers from the page, which fetched
 * them from its own cache or origin: nothing here touches the network. Pinned to the ONNX Runtime Web 1.31 API.
 */
let session: ort.InferenceSession | undefined;
let input = '';

const send = (message: FromWorker, transfer: Transferable[] = []) => (self as DedicatedWorkerGlobalScope).postMessage(message, transfer);

self.onmessage = async ({ data }: MessageEvent<ToWorker>) => {
  try {
    if (data.type === 'init') {
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
      ort.env.wasm.wasmBinary = data.wasm;
      session = await ort.InferenceSession.create(new Uint8Array(data.model), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
      input = session.inputNames[0];
      // The runtime has copied both files into its own memory: detach ours now instead of waiting for V8 to collect them
      // (steady 213 -> 161 MB measured, 33-3/33-4). Feature-detected: an engine without `transfer` keeps the old behaviour.
      ort.env.wasm.wasmBinary = undefined;
      data.model.transfer?.(0);
      data.wasm.transfer?.(0);
      send({ type: 'ready' });
    } else if (data.type === 'run') {
      if (!session) throw new Error('not initialized');
      const output = await session.run({ [input]: new ort.Tensor('float32', data.pixels, [1, 3, data.size, data.size]) });
      const embedding = (output[session.outputNames[0]].data as Float32Array).slice();
      send({ type: 'result', id: data.id, embedding }, [embedding.buffer]);
    }
  } catch (error) {
    send({ type: 'failed', id: data.type === 'run' ? data.id : undefined, message: error instanceof Error ? error.message : String(error) });
  }
};
