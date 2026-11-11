import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BACKOFF_START_MS,
  BATCH_EVENTS,
  BUDGET,
  BUFFER_MAX,
  FLUSH_DELAY_MS,
  MIN_GAP_MS,
  createDiagnostics,
  type DiagnosticsDeps,
  type SendResult,
} from './diagnostics';

function setup(answers: SendResult[] = []) {
  const send = vi.fn(async (): Promise<SendResult> => answers.shift() ?? { status: 204 });
  const onOff = vi.fn();
  const onTermsRequired = vi.fn();
  let route: string | null = 'discover';
  const deps: DiagnosticsDeps = { send, device: () => ({ language: 'en' }), route: () => route, build: '0.1.0 (test)', onOff, onTermsRequired };
  const diagnostics = createDiagnostics(deps);
  diagnostics.update({ enabled: true, canSend: true });
  return { diagnostics, send, onOff, onTermsRequired, setRoute: (name: string | null) => (route = name) };
}

const batchOf = (send: ReturnType<typeof setup>['send'], call = 0) =>
  (send.mock.calls[call] as unknown as [{ device: object; events: { message: string; count: number; route: string; build: string; stack?: string }[] }])[0];

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('collecting', () => {
  it('collects nothing while opted out or signed out, and nothing is ever sent', async () => {
    const { diagnostics, send } = setup();
    diagnostics.update({ enabled: false, canSend: true });
    diagnostics.capture('ERROR', 'boom');
    expect(diagnostics.pending()).toBe(0);
    await vi.advanceTimersByTimeAsync(10 * MIN_GAP_MS);
    expect(send).not.toHaveBeenCalled();
  });

  it('scrubs, names the route and the build, and merges repeats into a count', async () => {
    const { diagnostics, send } = setup();
    diagnostics.capture('ERROR', 'row 1 failed for anna@example.org #/verify/' + 'x'.repeat(43));
    diagnostics.capture('ERROR', 'row 2 failed for bob@example.org');
    expect(diagnostics.pending()).toBe(1);
    await vi.advanceTimersByTimeAsync(FLUSH_DELAY_MS);
    const [event] = batchOf(send).events;
    expect(event).toMatchObject({ message: 'row 1 failed for [email]', count: 2, route: 'discover', build: '0.1.0 (test)' });
    expect(JSON.stringify(batchOf(send))).not.toMatch(/anna|verify|xxxx/);
  });

  it('does not collect on a page that shows a token', () => {
    const { diagnostics, setRoute } = setup();
    setRoute(null);
    diagnostics.capture('ERROR', 'boom');
    expect(diagnostics.pending()).toBe(0);
  });

  it('keeps an event within 4 KB by shortening a long multi-byte stack', async () => {
    const { diagnostics, send } = setup();
    diagnostics.capture('ERROR', 'boom', 'ä'.repeat(5000));
    await vi.advanceTimersByTimeAsync(FLUSH_DELAY_MS);
    const [event] = batchOf(send).events;
    expect(new TextEncoder().encode(JSON.stringify(event)).length).toBeLessThanOrEqual(4096);
  });

  it('caps the buffer', () => {
    const { diagnostics } = setup();
    diagnostics.update({ enabled: true, canSend: false });
    for (let i = 0; i < BUFFER_MAX + 20; i++)
      diagnostics.capture(
        'ERROR',
        `distinct message ${'abcdefghij'[i % 10]}${String.fromCharCode(97 + (i % 26))} ${'q'.repeat(i % 7)}-${String.fromCharCode(65 + Math.floor(i / 26))}`,
      );
    expect(diagnostics.pending()).toBeLessThanOrEqual(BUFFER_MAX);
  });
});

describe('sending', () => {
  it('waits while offline and sends once the connection is back', async () => {
    const { diagnostics, send } = setup();
    diagnostics.update({ enabled: true, canSend: false });
    diagnostics.capture('WARNING', 'slow');
    await vi.advanceTimersByTimeAsync(5 * MIN_GAP_MS);
    expect(send).not.toHaveBeenCalled();
    expect(diagnostics.pending()).toBe(1);
    diagnostics.update({ enabled: true, canSend: true });
    await vi.advanceTimersByTimeAsync(FLUSH_DELAY_MS);
    expect(send).toHaveBeenCalledTimes(1);
    expect(diagnostics.pending()).toBe(0);
  });

  it('turning the choice off drops the buffer at once and stops the timer', async () => {
    const { diagnostics, send } = setup();
    diagnostics.capture('ERROR', 'boom');
    diagnostics.update({ enabled: false, canSend: true });
    expect(diagnostics.pending()).toBe(0);
    await vi.advanceTimersByTimeAsync(10 * MIN_GAP_MS);
    expect(send).not.toHaveBeenCalled();
  });

  it('spaces batches, with at most 20 events each and 20 per ten minutes', async () => {
    const { diagnostics, send } = setup();
    for (let i = 0; i < 30; i++) diagnostics.capture('ERROR', `unique ${String.fromCharCode(97 + Math.floor(i / 26))}${String.fromCharCode(97 + (i % 26))}`);
    await vi.advanceTimersByTimeAsync(FLUSH_DELAY_MS);
    expect(batchOf(send).events).toHaveLength(BATCH_EVENTS);
    await vi.advanceTimersByTimeAsync(MIN_GAP_MS * 3);
    // The budget of 20 per ten minutes is spent: the other 10 wait for the window to pass.
    expect(send).toHaveBeenCalledTimes(1);
    expect(BUDGET).toBe(20);
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(send).toHaveBeenCalledTimes(2);
    expect(batchOf(send, 1).events).toHaveLength(10);
  });

  it('409 clears the buffer, stops and asks the app to read the account again', async () => {
    const { diagnostics, send, onOff } = setup([{ status: 409 }]);
    diagnostics.capture('ERROR', 'boom');
    await vi.advanceTimersByTimeAsync(FLUSH_DELAY_MS);
    expect(onOff).toHaveBeenCalledTimes(1);
    expect(diagnostics.pending()).toBe(0);
    await vi.advanceTimersByTimeAsync(10 * MIN_GAP_MS);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it.each([400, 413])('%i drops the batch and never retries or reports it', async (status) => {
    const { diagnostics, send } = setup([{ status }]);
    diagnostics.capture('ERROR', 'boom');
    await vi.advanceTimersByTimeAsync(FLUSH_DELAY_MS);
    expect(diagnostics.pending()).toBe(0);
    await vi.advanceTimersByTimeAsync(10 * MIN_GAP_MS);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('428 pauses until the app says sending is allowed again', async () => {
    const { diagnostics, send, onTermsRequired } = setup([{ status: 428 }]);
    diagnostics.capture('ERROR', 'boom');
    await vi.advanceTimersByTimeAsync(FLUSH_DELAY_MS);
    expect(onTermsRequired).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10 * MIN_GAP_MS);
    expect(send).toHaveBeenCalledTimes(1);
    expect(diagnostics.pending()).toBe(1);
    diagnostics.update({ enabled: true, canSend: true });
    await vi.advanceTimersByTimeAsync(MIN_GAP_MS);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('429 waits for Retry-After, then sends the same events', async () => {
    const { diagnostics, send } = setup([{ status: 429, retryAfter: 120 }]);
    diagnostics.capture('ERROR', 'boom');
    await vi.advanceTimersByTimeAsync(FLUSH_DELAY_MS);
    await vi.advanceTimersByTimeAsync(110_000);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(send).toHaveBeenCalledTimes(2);
    expect(diagnostics.pending()).toBe(0);
  });

  it('an unreachable server backs off with a doubling wait, not a loop', async () => {
    const { diagnostics, send } = setup([{ status: 0 }, { status: 0 }]);
    diagnostics.capture('ERROR', 'boom');
    await vi.advanceTimersByTimeAsync(FLUSH_DELAY_MS);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(BACKOFF_START_MS - 1000);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(BACKOFF_START_MS * 2 - 5000);
    expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('a failure of the sender itself is not captured as an event', async () => {
    const { diagnostics, send } = setup();
    send.mockImplementationOnce(async () => {
      throw new Error('network down');
    });
    diagnostics.capture('ERROR', 'boom');
    await vi.advanceTimersByTimeAsync(FLUSH_DELAY_MS);
    expect(diagnostics.pending()).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
