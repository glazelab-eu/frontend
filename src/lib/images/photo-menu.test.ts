import { describe, expect, it } from 'vitest';
import { photoMenuEntries, reportReason } from './photo-menu';

const actions = (own: boolean, canDelete: boolean, signedIn = true, online = true) =>
  photoMenuEntries({ own, canDelete }, signedIn, online).map((entry) => entry.action);

describe('photoMenuEntries', () => {
  it.each([
    [
      'the uploader: edit details, change the type and focus, choose who sees it and delete, never report',
      true,
      true,
      true,
      ['details', 'kind', 'focus', 'visibility', 'delete'],
    ],
    ['another user: report only', false, false, true, ['report']],
    [
      'a club or site admin on another person’s photo: change the type, delete and report, never edit the details',
      false,
      true,
      true,
      ['kind', 'focus', 'delete', 'report'],
    ],
    ['a guest on another person’s photo: no menu', false, false, false, []],
    ['a guest, whatever the photo says: no menu', true, true, false, []],
  ])('offers %s', (_case, own, canDelete, signedIn, expected) => {
    expect(actions(own, canDelete, signedIn)).toEqual(expected);
  });

  it('keeps the entries offline but disables them', () => {
    const entries = photoMenuEntries({ own: true, canDelete: true }, true, false);
    expect(entries.map((entry) => entry.action)).toEqual(['details', 'kind', 'focus', 'visibility', 'delete']);
    expect(entries.every((entry) => entry.disabled)).toBe(true);
    expect(photoMenuEntries({ own: false, canDelete: false }, true, true).some((e) => e.disabled)).toBe(false);
  });
});

describe('reportReason', () => {
  it('trims the text and sends none for blank input', () => {
    expect(reportReason('  Not a glaze  ')).toBe('Not a glaze');
    expect(reportReason(' \n ')).toBeNull();
    expect(reportReason('')).toBeNull();
  });
});
