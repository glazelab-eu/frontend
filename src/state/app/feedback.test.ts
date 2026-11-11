import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import type { FeedbackContext } from '../../lib/feedback/feedback';
import { loaded, routes, stubBrowser, useMockApi, user } from './test-helpers';

useMockApi();

const context: FeedbackContext = { route: 'stock', build: '0.1.0 (abc)', language: 'en', device: 'PHONE' };
const photo = () => new File([new Uint8Array([1, 2, 3])], 'photo.jpg', { type: 'image/jpeg' });

async function signedIn() {
  routes['GET /api/auth/me'] = () => Response.json(user);
  routes['GET /api/auth/csrf'] = () => Response.json({ token: 'csrf' });
  const { app } = await loaded();
  return app;
}

/** Records the multipart bodies `POST /api/feedback` received, as name → values. */
function recordFeedback(answer: () => Response) {
  const sent: Record<string, (string | File)[]>[] = [];
  routes['POST /api/feedback'] = async (request) => {
    const form = await request.formData();
    const parts: Record<string, (string | File)[]> = {};
    for (const [name, value] of form.entries()) (parts[name] ??= []).push(value);
    sent.push(parts);
    return answer();
  };
  return sent;
}

describe('feedback', () => {
  it('opens only for a signed-in account', async () => {
    routes['GET /api/auth/me'] = () => Response.json({ error: 'Please sign in.' }, { status: 401 });
    const { app } = await loaded();
    expect(get(app.state).user).toBeNull();
    app.openFeedback();
    expect(get(app.state).feedbackOpen).toBe(false);
  });

  it('sends text, context and photos, then clears the draft, closes the dialog and confirms', async () => {
    const app = await signedIn();
    app.openFeedback();
    const draft = { message: '  The shelf jumps.  ', photos: [photo(), photo()], withContext: true };
    app.keepFeedbackDraft(draft);
    const sent = recordFeedback(() => Response.json({ id: 'f1' }));
    expect(await app.sendFeedback(draft, context)).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].message).toEqual(['The shelf jumps.']);
    expect(sent[0]).toMatchObject({ route: ['stock'], build: ['0.1.0 (abc)'], language: ['en'], device: ['PHONE'] });
    expect(sent[0].files).toHaveLength(2);
    expect(get(app.state)).toMatchObject({ feedbackOpen: false, toast: 'notices.feedbackSent' });
    expect(app.feedbackDraft()).toEqual({ message: '', photos: [], withContext: true });
  });

  it('says when a photo still being prepared was dropped with the closing dialog, and never to a signed-out device', async () => {
    const app = await signedIn();
    app.feedbackPhotoDropped();
    expect(get(app.state).toast).toBe('notices.feedbackPhotoDropped');
    routes['GET /api/auth/me'] = () => Response.json({ error: 'Please sign in.' }, { status: 401 });
    const { app: guest } = await loaded();
    guest.feedbackPhotoDropped();
    expect(get(guest.state).toast).toBe('');
  });

  it('leaves the context out when the sender unticked it', async () => {
    const app = await signedIn();
    const sent = recordFeedback(() => Response.json({ id: 'f1' }));
    expect(await app.sendFeedback({ message: 'Plain', photos: [], withContext: false }, context)).toBe(true);
    expect(Object.keys(sent[0])).toEqual(['message']);
  });

  it('keeps the draft and the dialog when the send fails, with the error at the form', async () => {
    const app = await signedIn();
    app.openFeedback();
    const draft = { message: 'Kept', photos: [photo()], withContext: true };
    app.keepFeedbackDraft(draft);
    recordFeedback(() => Response.json({ error: 'Too many requests' }, { status: 429 }));
    expect(await app.sendFeedback(draft, context)).toBe(false);
    expect(get(app.state)).toMatchObject({ feedbackOpen: true, formError: { form: 'feedback' } });
    expect(app.feedbackDraft()).toMatchObject({ message: 'Kept', withContext: true });
    expect(app.feedbackDraft().photos).toHaveLength(1);
  });

  it('a sign-out drops the draft and closes the dialog, so nothing of it stays for the next account', async () => {
    stubBrowser('#/');
    const app = await signedIn();
    app.openFeedback();
    app.keepFeedbackDraft({ message: 'Private words', photos: [photo()], withContext: false });
    routes['POST /api/auth/logout'] = () => {
      routes['GET /api/auth/me'] = () => Response.json({ error: 'Please sign in.' }, { status: 401 });
      return new Response(null, { status: 204 });
    };
    await app.logout();
    expect(get(app.state)).toMatchObject({ user: null, feedbackOpen: false });
    expect(app.feedbackDraft()).toEqual({ message: '', photos: [], withContext: true });
    // A guest cannot keep a draft either.
    app.keepFeedbackDraft({ message: 'Guest words', photos: [], withContext: true });
    expect(app.feedbackDraft().message).toBe('');
  });

  it('sends nothing offline and keeps the draft', async () => {
    const app = await signedIn();
    const draft = { message: 'Offline', photos: [], withContext: true };
    app.keepFeedbackDraft(draft);
    const sent = recordFeedback(() => Response.json({ id: 'f1' }));
    routes['GET /api/glazes'] = () => Promise.reject(new TypeError('offline'));
    routes['GET /api/sync'] = () => Promise.reject(new TypeError('offline'));
    await app.refresh();
    expect(get(app.state).online).toBe(false);
    expect(await app.sendFeedback(draft, context)).toBe(false);
    expect(sent).toHaveLength(0);
    expect(app.feedbackDraft().message).toBe('Offline');
  });
});
