import type { MessageKey } from '../i18n';

/** The fields of the change-password form. */
export interface PasswordChangeDraft {
  current: string;
  next: string;
  confirmation: string;
}

/** The API's limits for a new password (`AuthController.PasswordChangeInput`, `AccountService.encode`). */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const PASSWORD_MAX_BYTES = 72;

/**
 * What stops the form before it is sent, or null: the confirmation must repeat the new password, which must differ from
 * the current one and fit bcrypt's 72 UTF-8 bytes. The server checks the same and stays authoritative; the lengths are
 * the fields' own `minlength`/`maxlength`.
 */
export function passwordChangeProblem({ current, next, confirmation }: PasswordChangeDraft): MessageKey | null {
  if (next === confirmation && next === current) return 'errors.passwordSame';
  return newPasswordProblem(next, confirmation);
}

/** The same checks for a password set from a reset or activation link, where there is no current one. */
export function newPasswordProblem(next: string, confirmation: string): MessageKey | null {
  if (next !== confirmation) return 'errors.passwordsMismatch';
  if (new TextEncoder().encode(next).length > PASSWORD_MAX_BYTES) return 'errors.passwordTooLong';
  return null;
}
