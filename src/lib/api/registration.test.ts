import { describe, expect, it } from 'vitest';
import { registrationBody, registrationNext } from './registration';

describe('registration', () => {
  it('sends email and display name only: never a password, the terms or the error-report choice (they come with the activation)', () => {
    const input = { mode: 'register' as const, email: 'new@example.test', displayName: 'New potter' };
    const draft = { ...input, password: 'left over from an old draft', termsAccepted: true, termsVersion: 'v1', diagnosticsOptIn: true };
    expect(registrationBody(draft as typeof input)).toEqual({ email: 'new@example.test', displayName: 'New potter' });
  });

  it('goes to the password step only with a setup token', () => {
    expect(registrationNext({ verificationRequired: true, setupToken: 'T'.repeat(43) }, false)).toEqual({ step: 'setup', token: 'T'.repeat(43) });
    // A token always wins: the server issues one only when it sends no mail.
    expect(registrationNext({ verificationRequired: true, setupToken: 'T'.repeat(43) }, true)).toEqual({ step: 'setup', token: 'T'.repeat(43) });
  });

  it('waits for the email when the server sends mail, and refuses a taken address without mail', () => {
    expect(registrationNext({ verificationRequired: true, setupToken: null }, true)).toEqual({ step: 'mail' });
    expect(registrationNext({ verificationRequired: true, setupToken: null }, false)).toEqual({ step: 'taken' });
    expect(registrationNext({ verificationRequired: true, setupToken: '' }, false)).toEqual({ step: 'taken' });
  });
});
