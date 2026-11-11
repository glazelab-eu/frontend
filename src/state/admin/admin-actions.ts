import { ApiError, api } from '../../lib/api/client';
import type {
  ImageDeletionPage,
  ImageReportPage,
  AvatarReport,
  AvatarReportPage,
  BanPage,
  FeedbackPage,
  AdminUserPage,
  ReportBuilds,
  ReportGroupPage,
  ReportOccurrencePage,
} from '../../lib/api/models';
import type { MessageKey } from '../../lib/i18n';
import type { FormName } from '../app/app-state';
import type { Write } from '../app/write';

interface AdminContext {
  query: <T>(action: () => Promise<T>, form?: FormName) => Promise<T | null>;
  mutate: <R>(spec: Write<R, unknown>) => Promise<boolean>;
  load: () => Promise<void>;
  notify: (key: MessageKey, actor?: string, values?: Record<string, number | string>) => void;
}

/** Admin operations use the controller's shared request lifecycle; they own no session or listing state. */
export function createAdminActions({ query, mutate, load, notify }: AdminContext) {
  /** One page of the image-deletion log (site admins); null after a failure. */
  function loadImageDeletions(page: number): Promise<ImageDeletionPage | null> {
    return query(() => api.imageDeletions(page), 'image-deletions');
  }

  /** One page of the photo-report queue (site admins), newest first; null after a failure. */
  function loadImageReports(page: number): Promise<ImageReportPage | null> {
    return query(() => api.imageReports(page), 'image-reports');
  }

  /** Removes a report and keeps its photo; one already gone (404) counts as dismissed. */
  function dismissImageReport(id: string) {
    return mutate({
      request: async () => {
        try {
          await api.dismissImageReport(id);
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 404) throw error;
        }
      },
      notice: 'notices.reportDismissed',
      form: 'image-reports',
      requireOnline: true,
      busy: `dismissing:${id}`,
    });
  }

  /** One page of the profile-picture report queue (site admins), newest first, optionally of one status; null after a failure. */
  function loadAvatarReports(page: number, status?: AvatarReport['status']): Promise<AvatarReportPage | null> {
    return query(() => api.avatarReports(page, status), 'avatar-reports');
  }

  /** An admin's decision about a reported profile picture (every open report of that picture): answers whether it was recorded. */
  function decideAvatarReport(request: () => Promise<unknown>, notice: MessageKey) {
    return mutate({
      request,
      notice,
      form: 'avatar-reports',
      requireOnline: true,
    });
  }
  const dismissAvatarReport = (id: string) => decideAvatarReport(() => api.dismissAvatarReport(id), 'notices.avatarReportDismissed');
  const removeReportedAvatar = (id: string) => decideAvatarReport(() => api.removeReportedAvatar(id), 'notices.avatarReportRemoved');
  /** Removes a picture that is still current but whose reports were dismissed (a site admin's own removal, which blocks it too). */
  const removeAvatarAsAdmin = (avatarId: string) => decideAvatarReport(() => api.removeAvatar(avatarId), 'notices.avatarReportRemoved');

  /**
   * A site admin bans an account (`blockPictures`: also its reported profile pictures). The account is removed like an own
   * deletion, so the listings, clubs and member lists are read again (a vanished or already removed account, 404, and a
   * change meanwhile, 409, reload before the refusal shows); the host reads its own queue again. Errors show in the dialog (form `ban`).
   */
  function banUser(id: string, name: string, reason: string, blockPictures: boolean) {
    return mutate({
      request: () => api.ban(id, reason, blockPictures),
      apply: async (_, actor) => {
        await load();
        notify('notices.banned', actor, { name });
      },
      reloadOn: [404, 409],
      requireOnline: true,
      busy: `ban:${id}`,
      form: 'ban',
    });
  }

  /** One page of the bans (site admins), newest first; null after a failure. */
  function loadBans(page: number): Promise<BanPage | null> {
    return query(() => api.bans(page), 'bans');
  }

  /** Lifts a ban (a ban that is already gone, 404, shows its refusal and the page reads the list again). */
  function unbanUser(id: string) {
    return mutate({
      request: () => api.unban(id),
      apply: async (_, actor) => notify('notices.banLifted', actor),
      requireOnline: true,
      busy: `unban:${id}`,
      form: 'unban',
    });
  }

  /** One page of the account list (site admins); null after a failure. */
  function loadUsers(page: number, q = ''): Promise<AdminUserPage | null> {
    return query(() => api.adminUsers(page, q), 'users');
  }

  /** One page of the error-report messages (site admins); null after a failure. */
  function loadErrorReportGroups(
    page: number,
    filter: { kind?: 'ERROR' | 'WARNING' | 'UNHANDLED_REJECTION'; build?: string; q?: string },
  ): Promise<ReportGroupPage | null> {
    return query(() => api.errorReportGroups(page, filter), 'error-reports');
  }
  function loadErrorReportBuilds(): Promise<ReportBuilds | null> {
    return query(() => api.errorReportBuilds());
  }
  /** One message's reports (a message deleted meanwhile, 404, is a failure the page shows). */
  function loadErrorReportOccurrences(fingerprint: string, page: number): Promise<ReportOccurrencePage | null> {
    return query(() => api.errorReportOccurrences(fingerprint, page), 'error-reports');
  }
  /** Deletes a whole message or one report; a 404 (gone meanwhile) shows its refusal and the page reads again. */
  function deleteErrorReports(target: { fingerprint: string } | { id: string }) {
    return mutate({
      request: () => ('fingerprint' in target ? api.deleteErrorReportGroup(target.fingerprint) : api.deleteErrorReport(target.id)),
      apply: async (_, actor) => {
        if ('fingerprint' in target) notify('notices.errorReportGroupDeleted', actor);
        else notify('notices.errorReportDeleted', actor);
      },
      requireOnline: true,
      busy: `error-report-delete:${'fingerprint' in target ? target.fingerprint : target.id}`,
      form: 'error-report-delete',
    });
  }

  /** One page of the feedback (site admins), newest first, optionally of one status; null after a failure. */
  function loadFeedback(page: number, status?: 'OPEN' | 'DONE'): Promise<FeedbackPage | null> {
    return query(() => api.adminFeedback(page, status), 'admin-feedback');
  }

  /** Marks a feedback done or open again; one deleted meanwhile (404) shows its refusal and the page reads again. */
  function markFeedback(id: string, status: 'OPEN' | 'DONE') {
    return mutate({
      request: () => api.markFeedback(id, status),
      apply: async (_, actor) => notify(status === 'DONE' ? 'notices.feedbackDone' : 'notices.feedbackReopened', actor),
      requireOnline: true,
      busy: `feedback:${id}`,
      form: 'admin-feedback-change',
    });
  }

  /** Deletes a feedback with its photos. */
  function deleteFeedback(id: string) {
    return mutate({
      request: () => api.deleteFeedback(id),
      apply: async (_, actor) => notify('notices.feedbackDeleted', actor),
      requireOnline: true,
      busy: `feedback:${id}`,
      form: 'admin-feedback-change',
    });
  }

  return {
    loadFeedback,
    markFeedback,
    deleteFeedback,
    loadImageDeletions,
    loadImageReports,
    dismissImageReport,
    loadAvatarReports,
    dismissAvatarReport,
    removeReportedAvatar,
    removeAvatarAsAdmin,
    banUser,
    loadBans,
    loadUsers,
    unbanUser,
    loadErrorReportGroups,
    loadErrorReportBuilds,
    loadErrorReportOccurrences,
    deleteErrorReports,
  };
}
