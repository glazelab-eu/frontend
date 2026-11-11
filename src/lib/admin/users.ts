import type { AdminUser } from '../api/models';
import type { MessageKey } from '../i18n/messages';

export const userIdOf = (user: Pick<AdminUser, 'id'>) => user.id;

/** The text of an account's status (`ACTIVE`, or `PENDING` while its email is not confirmed). */
export const accountStatusKey = (status: AdminUser['status']): MessageKey => (status === 'PENDING' ? 'users.status.PENDING' : 'users.status.ACTIVE');

/** The longest search text the API uses (it cuts more off). */
export const MAX_USER_SEARCH = 100;

/** The search text as sent: stripped, cut to {@link MAX_USER_SEARCH}. */
export const userSearchText = (text: string) => text.trim().slice(0, MAX_USER_SEARCH).trim();

/** The registration day of an account, in the reader's language; empty for accounts without a recorded time. */
export function formatCreatedOn(instant: AdminUser['createdAt'], locale: string): string {
  if (!instant) return '';
  const time = new Date(instant);
  if (Number.isNaN(time.getTime())) return '';
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : locale, { dateStyle: 'medium' }).format(time);
}
