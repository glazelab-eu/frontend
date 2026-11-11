import { api } from '../../lib/api/client';
import { emptyFeedbackDraft, type FeedbackContext, type FeedbackDraft } from '../../lib/feedback/feedback';
import type { AppContext } from '../app/context';

/**
 * In-app feedback (backend guide "Feedback"): the dialog's open state, the draft and the send. The draft lives in memory only (never
 * stored on the device), per account: it survives closing the dialog, a page change, a failed send and being offline, and goes on
 * a successful send, sign-out and another account.
 */
export function createFeedbackActions(ctx: Pick<AppContext, 'read' | 'patch' | 'mutate' | 'notify' | 'onAccountChange'>) {
  let draft: FeedbackDraft = emptyFeedbackDraft();
  ctx.onAccountChange(() => {
    draft = emptyFeedbackDraft();
  });

  /** Signed-in accounts only: guests never see the button, and the API answers 401. */
  function openFeedback() {
    if (ctx.read().user) ctx.patch({ feedbackOpen: true, formError: null });
  }

  function closeFeedback() {
    ctx.patch({ feedbackOpen: false, formError: null });
  }

  /** The draft as the dialog left it (a copy: the dialog edits its own). */
  function feedbackDraft(): FeedbackDraft {
    return { ...draft, photos: [...draft.photos] };
  }

  function keepFeedbackDraft(next: FeedbackDraft) {
    if (ctx.read().user) draft = { ...next, photos: [...next.photos] };
  }

  /** The dialog closed by a page change while a photo was still being prepared: that photo is not in the draft, so say so. */
  function feedbackPhotoDropped() {
    if (ctx.read().user) ctx.notify('notices.feedbackPhotoDropped');
  }

  /** Sends the draft as given (needs a connection); success clears the draft, closes the dialog and confirms with a toast. */
  function sendFeedback(sent: FeedbackDraft, context: FeedbackContext) {
    return ctx.mutate({
      request: () => api.sendFeedback({ message: sent.message.trim(), context: sent.withContext ? context : null, photos: sent.photos }),
      apply: async () => {
        draft = emptyFeedbackDraft();
        ctx.patch({ feedbackOpen: false });
      },
      notice: 'notices.feedbackSent',
      form: 'feedback',
      requireOnline: true,
      busy: 'feedback',
    });
  }

  return { openFeedback, closeFeedback, feedbackDraft, keepFeedbackDraft, feedbackPhotoDropped, sendFeedback };
}
