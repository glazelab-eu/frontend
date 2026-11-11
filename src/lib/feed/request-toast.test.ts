import { describe, expect, it } from 'vitest';
import { home } from '../routing/routes';
import { freshRequestMemory, requestNews, requestShownBy, type RequestMemory } from './request-toast';

const ADA = 'a0000000-0000-4000-8000-000000000001';
const BEN = 'b0000000-0000-4000-8000-000000000002';
const at = (minute: number) => `2026-11-08T10:${String(minute).padStart(2, '0')}:00Z`;
const request = (id: string, name: string, minute: number, requests = 1) => ({ requesterId: id, requesterName: name, requestedAt: at(minute), requests });
const none = { requesterId: null, requesterName: null, requestedAt: null, requests: 0 };
const loud = { known: [] as string[], quiet: false };

/** Runs answers through the decision like the poll does and collects what each one did to the toast. */
function run(answers: Parameters<typeof requestNews>[1][], context = loud, memory: RequestMemory = freshRequestMemory()) {
  const toasts: unknown[] = [];
  for (const answer of answers) {
    const next = requestNews(memory, answer, context);
    memory = next.memory;
    toasts.push(next.toast);
  }
  return { toasts, memory };
}

describe('requestNews', () => {
  it('sets the baseline with the first answer: a request known when the app loaded is not announced', () => {
    expect(run([request(ADA, 'Ada', 1)], { known: [ADA], quiet: false }).toasts).toEqual([undefined]);
    expect(run([none, request(ADA, 'Ada', 1)], { known: [ADA], quiet: false }).toasts).toEqual([null, { id: ADA, name: 'Ada', others: 0 }]);
  });

  it('announces a request that arrived after the load, even in the first answer', () => {
    expect(run([request(ADA, 'Ada', 1)]).toasts).toEqual([{ id: ADA, name: 'Ada', others: 0 }]);
  });

  it('announces a new request once: the same answer again changes nothing', () => {
    const { toasts } = run([none, request(ADA, 'Ada', 1), request(ADA, 'Ada', 1), request(ADA, 'Ada', 1)]);
    expect(toasts).toEqual([null, { id: ADA, name: 'Ada', others: 0 }, undefined, undefined]);
  });

  it('names the newest of several and counts the others; one toast per answer', () => {
    const { toasts } = run([none, request(BEN, 'Ben', 3, 3)]);
    expect(toasts[1]).toEqual({ id: BEN, name: 'Ben', others: 2 });
    expect(run([none, request(ADA, 'Ada', 1), request(BEN, 'Ben', 2, 2)]).toasts.slice(1)).toEqual([
      { id: ADA, name: 'Ada', others: 0 },
      { id: BEN, name: 'Ben', others: 1 },
    ]);
  });

  it('closes the toast once nothing unseen waits (answered, withdrawn or seen meanwhile) and never brings an older request back', () => {
    const { toasts } = run([none, request(BEN, 'Ben', 2, 2), request(ADA, 'Ada', 1), none, request(ADA, 'Ada', 1)]);
    expect(toasts).toEqual([null, { id: BEN, name: 'Ben', others: 1 }, null, null, null]);
  });

  it('closes a toast whose request is gone while older ones still wait, and announces none of those again (FEED-2 review)', () => {
    // Ben (the toast) withdrew; Ada, already counted in "and 1 other", is the newest unseen one now: no toast names Ben any more.
    const { toasts, memory } = run([none, request(BEN, 'Ben', 2, 2), request(ADA, 'Ada', 1), request(ADA, 'Ada', 1)]);
    expect(toasts).toEqual([null, { id: BEN, name: 'Ben', others: 1 }, null, null]);
    // A later request is still news.
    expect(run([request(ADA, 'Ada', 3, 2)], loud, memory).toasts).toEqual([{ id: ADA, name: 'Ada', others: 1 }]);
  });

  it('announces a request sent again later by the same account (a new request)', () => {
    const { toasts } = run([none, request(ADA, 'Ada', 1), none, request(ADA, 'Ada', 5)]);
    expect(toasts).toEqual([null, { id: ADA, name: 'Ada', others: 0 }, null, { id: ADA, name: 'Ada', others: 0 }]);
  });

  it('records a request without a toast while the page shows it (activity page, buddy dialog)', () => {
    const quiet = { known: [], quiet: true };
    const first = run([none, request(ADA, 'Ada', 1)], quiet);
    expect(first.toasts).toEqual([null, undefined]);
    // Back on another page: the same request is not announced afterwards; a newer one is.
    expect(run([request(ADA, 'Ada', 1), request(BEN, 'Ben', 2, 2)], loud, first.memory).toasts).toEqual([undefined, { id: BEN, name: 'Ben', others: 1 }]);
    expect(run([request(ADA, 'Ada', 1)], quiet).toasts).toEqual([undefined]);
  });

  it('a fresh memory (an account change, a sign-in) starts from the baseline again', () => {
    const before = run([none, request(ADA, 'Ada', 1)]);
    expect(before.memory).toEqual({ ready: true, through: Date.parse(at(1)) });
    expect(run([request(ADA, 'Ada', 1)], { known: [ADA], quiet: false }, freshRequestMemory()).toasts).toEqual([undefined]);
  });

  it('an API without the fields (before FEED-2) never shows a toast and keeps no baseline', () => {
    const { toasts, memory } = run([{}, { requests: undefined }, {}]);
    expect(toasts).toEqual([undefined, undefined, undefined]);
    expect(memory).toEqual(freshRequestMemory());
  });

  it('an unreadable time or a missing name counts as no request', () => {
    expect(run([{ ...request(ADA, 'Ada', 1), requestedAt: 'soon' }]).toasts).toEqual([null]);
    expect(run([{ ...request(ADA, '', 1) }]).toasts).toEqual([null]);
  });
});

describe('requestShownBy', () => {
  it('is the activity page and the buddy link dialog only', () => {
    expect(requestShownBy({ name: 'activity' })).toBe(true);
    expect(requestShownBy({ name: 'buddy', token: 'x' })).toBe(true);
    expect(requestShownBy({ name: 'account' })).toBe(false);
    expect(requestShownBy(home)).toBe(false);
  });
});
