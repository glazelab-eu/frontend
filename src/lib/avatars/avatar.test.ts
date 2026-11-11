import en from '../i18n/en.json';
import de from '../i18n/de.json';
import ptPT from '../i18n/pt-PT.json';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_AVATAR_SOURCE_BYTES, avatarFileProblem, avatarUrls, canSaveAvatar, forgetKeptAvatarUrls, keepAvatarUrl, keptAvatarUrl } from './avatar';

describe('chosen files', () => {
  it('accepts an image of a reasonable size', () => {
    expect(avatarFileProblem({ size: 3_000_000, type: 'image/jpeg', name: 'a' })).toBeNull();
    expect(avatarFileProblem({ size: MAX_AVATAR_SOURCE_BYTES, type: 'image/png', name: 'a' })).toBeNull();
  });

  it('names why a file is not tried', () => {
    expect(avatarFileProblem({ size: 0, type: 'image/png', name: 'a' })).toBe('empty');
    expect(avatarFileProblem({ size: 10, type: 'application/pdf', name: 'a' })).toBe('notImage');
    expect(avatarFileProblem({ size: 10, type: '', name: 'a' })).toBe('notImage');
    expect(avatarFileProblem({ size: MAX_AVATAR_SOURCE_BYTES + 1, type: 'image/png', name: 'a' })).toBe('tooLarge');
  });

  it('tries a HEIC photo by type or by name, whatever its type (iOS gives the Files app and AirDrop an empty one)', () => {
    expect(avatarFileProblem({ size: 3_000_000, type: 'image/heic', name: 'IMG_1.HEIC' })).toBeNull();
    expect(avatarFileProblem({ size: 3_000_000, type: '', name: 'IMG_1.HEIC' })).toBeNull();
    expect(avatarFileProblem({ size: 3_000_000, type: 'application/octet-stream', name: 'IMG_1.heif' })).toBeNull();
    expect(avatarFileProblem({ size: 0, type: '', name: 'IMG_1.HEIC' })).toBe('empty');
    expect(avatarFileProblem({ size: MAX_AVATAR_SOURCE_BYTES + 1, type: '', name: 'IMG_1.heic' })).toBe('tooLarge');
    expect(avatarFileProblem({ size: 10, type: '', name: 'notes.txt' })).toBe('notImage');
  });
});

describe('when the dialog may send', () => {
  const ready = { noticeShown: true, ready: true, online: true, busy: false };

  it('sends when the notice is shown and everything else is in place', () => {
    expect(canSaveAvatar(ready)).toBe(true);
  });

  it('never sends before the notice is shown', () => {
    expect(canSaveAvatar({ ...ready, noticeShown: false })).toBe(false);
  });

  it('waits for the picture, the connection and a running send', () => {
    expect(canSaveAvatar({ ...ready, ready: false })).toBe(false);
    expect(canSaveAvatar({ ...ready, online: false })).toBe(false);
    expect(canSaveAvatar({ ...ready, busy: true })).toBe(false);
  });
});

describe('urls', () => {
  it('names both sizes by the picture ID', () => {
    expect(avatarUrls('abc')).toEqual({ full: '/api/avatars/abc', small: '/api/avatars/abc/small' });
  });
});

describe('the content rule', () => {
  it('says in every language that the writer holds the rights', () => {
    expect(en['account.avatar.rule']).toMatch(/you have the rights/);
    expect(de['account.avatar.rule']).toMatch(/du die Rechte hast/);
    // pt-PT: the picture is one the writer holds the rights to (the old wording only said that rights exist, not whose).
    expect(ptPT['account.avatar.rule']).toMatch(/sobre a qual tenha direitos/);
    expect(ptPT['account.avatar.rule']).not.toMatch(/existam/);
  });
});

describe('kept profile picture URLs', () => {
  const revoked: string[] = [];
  beforeEach(() => {
    forgetKeptAvatarUrls();
    revoked.length = 0;
    vi.stubGlobal('URL', { ...URL, revokeObjectURL: (url: string) => revoked.push(url) });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('hands a later view the URL kept for the same account and picture', () => {
    expect(keptAvatarUrl('u1', '/api/avatars/a/small')).toBeUndefined();
    expect(keepAvatarUrl('u1', '/api/avatars/a/small', 'blob:1')).toBe('blob:1');
    expect(keptAvatarUrl('u1', '/api/avatars/a/small')).toBe('blob:1');
    expect(keptAvatarUrl('u2', '/api/avatars/a/small')).toBeUndefined();
    expect(keptAvatarUrl('u1', '/api/avatars/a')).toBeUndefined();
  });

  it('keeps the first URL of a picture and revokes a duplicate', () => {
    keepAvatarUrl('u1', '/api/avatars/a/small', 'blob:1');
    expect(keepAvatarUrl('u1', '/api/avatars/a/small', 'blob:2')).toBe('blob:1');
    expect(revoked).toEqual(['blob:2']);
  });

  it('forgets and revokes chosen pictures or all of them', () => {
    keepAvatarUrl('u1', '/api/avatars/a/small', 'blob:1');
    keepAvatarUrl('u1', '/api/avatars/b/small', 'blob:2');
    forgetKeptAvatarUrls((url) => url.includes('/a/'));
    expect(revoked).toEqual(['blob:1']);
    expect(keptAvatarUrl('u1', '/api/avatars/b/small')).toBe('blob:2');
    forgetKeptAvatarUrls();
    expect(revoked).toEqual(['blob:1', 'blob:2']);
    expect(keptAvatarUrl('u1', '/api/avatars/b/small')).toBeUndefined();
  });
});
