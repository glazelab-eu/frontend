import type { FeedbackPhoto } from '../api/models';
import type { MessageKey } from '../i18n';

/** The API's `glazelab.feedback.retention` (days after a feedback was marked done); the terms promise it. */
export const FEEDBACK_RETENTION_DAYS = 90;

export const FEEDBACK_FILTERS = ['OPEN', 'DONE', 'ALL'] as const;
export type FeedbackFilter = (typeof FEEDBACK_FILTERS)[number];

/** The API's `status` parameter: all feedback without one. */
export const filterStatus = (filter: FeedbackFilter): 'OPEN' | 'DONE' | undefined => (filter === 'ALL' ? undefined : filter);

export const feedbackFilterKey = (filter: FeedbackFilter): MessageKey =>
  filter === 'OPEN' ? 'feedbackAdmin.filter.open' : filter === 'DONE' ? 'feedbackAdmin.filter.done' : 'feedbackAdmin.filter.all';

/** A feedback photo for site admins: the 480 px card for the list, the full size for the viewer (both `no-store`). */
export const feedbackPhotoUrl = (photo: Pick<FeedbackPhoto, 'id'>, size: 'card' | 'full') =>
  `/api/admin/feedback/photos/${encodeURIComponent(photo.id)}${size === 'card' ? '/card' : ''}`;
