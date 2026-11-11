import { describe, expect, it } from 'vitest';
import { newPasswordProblem, passwordChangeProblem } from './password-change';

describe('passwordChangeProblem', () => {
  const draft = { current: 'old secret 1', next: 'new secret 2', confirmation: 'new secret 2' };

  it('lets a confirmed new password through', () => {
    expect(passwordChangeProblem(draft)).toBeNull();
  });

  it('asks for the same new password twice', () => {
    expect(passwordChangeProblem({ ...draft, confirmation: 'new secret 3' })).toBe('errors.passwordsMismatch');
  });

  it('refuses the current password as the new one, the mismatch first', () => {
    expect(passwordChangeProblem({ ...draft, next: draft.current, confirmation: draft.current })).toBe('errors.passwordSame');
    expect(passwordChangeProblem({ ...draft, next: draft.current })).toBe('errors.passwordsMismatch');
  });

  it('counts UTF-8 bytes, not characters, against the 72-byte limit', () => {
    const fits = 'ü'.repeat(36);
    expect(passwordChangeProblem({ ...draft, next: fits, confirmation: fits })).toBeNull();
    const tooLong = 'ü'.repeat(37);
    expect(passwordChangeProblem({ ...draft, next: tooLong, confirmation: tooLong })).toBe('errors.passwordTooLong');
  });
});

describe('newPasswordProblem (reset and activation links)', () => {
  it('asks for the same password twice, then counts UTF-8 bytes against the 72-byte limit', () => {
    expect(newPasswordProblem('new secret 2', 'new secret 2')).toBeNull();
    expect(newPasswordProblem('new secret 2', 'new secret 3')).toBe('errors.passwordsMismatch');
    expect(newPasswordProblem('ü'.repeat(36), 'ü'.repeat(36))).toBeNull();
    expect(newPasswordProblem('ü'.repeat(37), 'ü'.repeat(37))).toBe('errors.passwordTooLong');
  });
});
