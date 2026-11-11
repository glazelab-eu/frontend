import type { ImageInfo } from '../api/models';
import type { MessageKey } from '../i18n/messages';

/** Longest report reason the API accepts (`ImageReport.MAX_REASON`), counted like `maxlength`. */
export const MAX_REPORT_REASON = 500;

export type PhotoMenuAction = 'details' | 'kind' | 'focus' | 'visibility' | 'delete' | 'report';

export const photoMenuLabel: Record<PhotoMenuAction, MessageKey> = {
  details: 'images.menu.details',
  kind: 'images.menu.kind',
  focus: 'images.menu.focus',
  visibility: 'images.menu.visibility',
  delete: 'images.menu.delete',
  report: 'images.menu.report',
};

export interface PhotoMenuEntry {
  action: PhotoMenuAction;
  /** Every entry changes data, so each waits for a connection. */
  disabled: boolean;
}

/**
 * The entries of a photo's menu, in order. The uploader edits its details (caption, firing date) and
 * chooses who sees it; whoever may delete it (`canDelete`: uploader, club admin of its club, site admin)
 * can change its type and its focus and delete it (the API applies the one rule to all three); every other signed-in user can
 * report it (the uploader deletes instead). A guest has no
 * menu at all. Offline the entries stay, disabled, so the way to them does not change with the connection.
 */
export function photoMenuEntries(image: Pick<ImageInfo, 'own' | 'canDelete'>, signedIn: boolean, online: boolean): PhotoMenuEntry[] {
  if (!signedIn) return [];
  const actions: PhotoMenuAction[] = [];
  if (image.own) actions.push('details');
  if (image.canDelete) actions.push('kind', 'focus');
  if (image.own) actions.push('visibility');
  if (image.canDelete) actions.push('delete');
  if (!image.own) actions.push('report');
  return actions.map((action) => ({ action, disabled: !online }));
}

/** A report reason as the API takes it: trimmed, none when blank. */
export const reportReason = (text: string): string | null => text.trim() || null;
