import { describe, expect, it } from 'vitest';
import { photoAudience, uploadAudience } from './photo-audience';
import { club, clubMember, combination } from '../../test/fixtures';

const kiln = club({ id: 'kiln', name: 'Kiln' });
const studio = club({ id: 'studio', name: 'Studio' });
const unlisted = club({ id: 'unlisted', name: 'Unlisted' });
const clubs = [kiln, studio, unlisted];
/** The uploader `me` shares Kiln with the author `ana`; Studio has no Ana; Unlisted has no loaded member list. */
const clubMembers = {
  kiln: [clubMember({ id: 'me' }), clubMember({ id: 'ana' })],
  studio: [clubMember({ id: 'me' })],
};

describe('photoAudience', () => {
  it("offers Everyone and only the clubs its author is in on someone else's combination, never Only me", () => {
    expect(photoAudience(clubs, clubMembers, 'me', 'ana')).toEqual({ private: false, clubs: [kiln], restricted: true });
    expect(photoAudience(clubs, {}, 'me', 'ana')).toEqual({ private: false, clubs: [], restricted: true });
  });

  it('keeps every option on the own combination, a glaze and a combination of a deleted account', () => {
    const all = { private: true, clubs, restricted: false };
    expect(photoAudience(clubs, clubMembers, 'me', 'me')).toEqual(all);
    expect(photoAudience(clubs, clubMembers, 'me', undefined)).toEqual(all);
    expect(photoAudience(clubs, clubMembers, 'me', null)).toEqual(all);
  });
});

describe('uploadAudience', () => {
  const state = {
    clubs,
    clubMembers,
    user: { id: 'me' },
    combinations: [combination({ id: 'hers', authorId: 'ana' }), combination({ id: 'mine', authorId: 'me' })],
  };

  it("narrows an upload to someone else's combination and leaves the own one and glazes alone", () => {
    expect(uploadAudience(state, { type: 'combination', id: 'hers' })).toEqual({ private: false, clubs: [kiln], restricted: true });
    expect(uploadAudience(state, { type: 'combination', id: 'mine' }).restricted).toBe(false);
    expect(uploadAudience(state, { type: 'glaze', id: 'hers' })).toEqual({ private: true, clubs, restricted: false });
  });
});
