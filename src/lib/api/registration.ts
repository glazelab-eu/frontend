import type { Register, RegistrationView } from '../generated/types.gen';
import type { AuthInput } from './inputs';

/**
 * The registration request: exactly email and display name. The password, the terms and the error-report choice come with
 * the activation, from whoever owns the mailbox.
 */
export function registrationBody({ email, displayName }: Extract<AuthInput, { mode: 'register' }>): Register {
  return { email, displayName };
}

/**
 * What follows a registration: the password step with the setup token (a mail-free server answers it only
 * for an address it has just registered), waiting for the emailed link, or, on a mail-free server without a
 * token, an address that cannot be registered here.
 */
export type RegistrationNext = { step: 'setup'; token: string } | { step: 'mail' } | { step: 'taken' };

export function registrationNext(view: RegistrationView, emailEnabled: boolean): RegistrationNext {
  if (view.setupToken) return { step: 'setup', token: view.setupToken };
  return emailEnabled ? { step: 'mail' } : { step: 'taken' };
}
