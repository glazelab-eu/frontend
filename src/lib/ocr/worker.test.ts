import { afterEach, describe, expect, it, vi } from 'vitest';
import { readLabelText } from './worker';

type Request = { jobId: string; action: string; payload: unknown };
function fake(reply: (request: Request) => 'resolve' | 'reject' | 'wait' = () => 'resolve') {
  const requests: Request[] = [];
  const worker = {
    onmessage: null as Worker['onmessage'],
    onerror: null as Worker['onerror'],
    onmessageerror: null as Worker['onmessageerror'],
    terminate: vi.fn(),
    postMessage: vi.fn((request: Request) => {
      requests.push(request);
      const status = reply(request);
      if (status !== 'wait')
        queueMicrotask(() =>
          worker.onmessage?.call(
            worker as unknown as Worker,
            new MessageEvent('message', {
              data: {
                jobId: request.jobId,
                status,
                data:
                  request.action === 'recognize'
                    ? {
                        text: 'PC-20',
                        blocks: [{ paragraphs: [{ lines: [{ words: [{ text: 'PC-20' }] }] }] }],
                      }
                    : {},
              },
            }),
          ),
        );
    }),
  };
  return { worker, requests, spawn: vi.fn(() => worker as unknown as Worker) };
}
afterEach(() => vi.useRealTimers());

describe('owned OCR worker', () => {
  it('uses same-origin core/data, no model IDB, and terminates after a result', async () => {
    const { worker, requests, spawn } = fake();
    const result = await readLabelText(new Uint8Array([1]), '/assets/ocr-test', new AbortController().signal, spawn);
    expect(result).toMatchObject({ text: 'PC-20', words: [{ text: 'PC-20' }] });
    expect(spawn).toHaveBeenCalledWith('/assets/ocr-test/worker.min.js');
    expect(requests.map((r) => r.action)).toEqual(['load', 'loadLanguage', 'initialize', 'setParameters', 'recognize']);
    expect(requests[0].payload).toMatchObject({
      options: { corePath: '/assets/ocr-test/tesseract-core-lstm.js' },
    });
    expect(requests[1].payload).toMatchObject({
      options: { langPath: '/assets/ocr-test', cacheMethod: 'none' },
    });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(worker.onmessage).toBeNull();
  });

  it('cancels initialization immediately, before the library could return a worker', async () => {
    const { worker, spawn } = fake(() => 'wait');
    const abort = new AbortController();
    const reading = readLabelText(new Uint8Array(), '/assets/ocr-test', abort.signal, spawn);
    const rejected = expect(reading).rejects.toMatchObject({ name: 'AbortError' });
    abort.abort();
    await rejected;
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it.each(['load', 'loadLanguage', 'initialize', 'recognize'])('cleans up a rejected %s job without hanging', async (action) => {
    const { worker, spawn } = fake((request) => (request.action === action ? 'reject' : 'resolve'));
    await expect(readLabelText(new Uint8Array(), '/assets/ocr-test', new AbortController().signal, spawn)).rejects.toMatchObject({ problem: 'failed' });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('bounds a stalled worker and releases it on timeout', async () => {
    vi.useFakeTimers();
    const { worker, spawn } = fake(() => 'wait');
    const reading = readLabelText(new Uint8Array(), '/assets/ocr-test', new AbortController().signal, spawn);
    const rejected = expect(reading).rejects.toMatchObject({ problem: 'timeout' });
    await vi.advanceTimersByTimeAsync(120_000);
    await rejected;
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('handles worker runtime and postMessage failures', async () => {
    const { worker, spawn } = fake(() => 'wait');
    const reading = readLabelText(new Uint8Array(), '/assets/ocr-test', new AbortController().signal, spawn);
    const rejected = expect(reading).rejects.toMatchObject({ problem: 'failed' });
    worker.onerror?.call(worker as unknown as Worker, new Event('error') as ErrorEvent);
    await rejected;
    const broken = fake();
    broken.worker.postMessage.mockImplementation(() => {
      throw new Error('clone failed');
    });
    await expect(readLabelText(new Uint8Array(), '/assets/ocr-test', new AbortController().signal, broken.spawn)).rejects.toMatchObject({ problem: 'failed' });
    expect(broken.worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('does not start a worker for an already cancelled scan', async () => {
    const { spawn } = fake();
    const abort = new AbortController();
    abort.abort();
    await expect(readLabelText(new Uint8Array(), '/assets/ocr-test', abort.signal, spawn)).rejects.toMatchObject({ name: 'AbortError' });
    expect(spawn).not.toHaveBeenCalled();
  });
});
