import { describe, expect, it } from 'vitest';
import { ApiError } from '../../lib/api/client';
import {
  clubForm,
  createAppState,
  emptyAccountData,
  formErrorFor,
  listStatus,
  loadFailureOf,
  refreshing,
  shownImageUrls,
  isGuest,
  termsPending,
  withImage,
  withNewGlaze,
  withCorrectedGlaze,
  withCombinationTitle,
  withNewImage,
  withoutGlaze,
} from './app-state';
import { termsVersion } from '../../lib/api/terms';
import type { User } from '../../lib/api/models';
import { INITIAL_SYNC } from '../../lib/sync/lifecycle';
import { combination, glaze, glazeStep, imageInfo, stockItem } from '../../test/fixtures';
import { get } from 'svelte/store';

describe('emptyAccountData', () => {
  it('covers every listing a new session starts with, as fresh values each time', () => {
    const { glazes, favorites, ...rest } = get(createAppState());
    expect(emptyAccountData()).toMatchObject({ glazes, favorites, stock: rest.stock });
    expect(Object.keys(emptyAccountData()).sort()).toEqual([
      'authorAvatars',
      'buddies',
      'buddyAvailability',
      'clubMembers',
      'clubWishlists',
      'clubs',
      'combinations',
      'favoriteCounts',
      'favorites',
      'glazes',
      'stock',
    ]);
    const first = emptyAccountData();
    first.stock.push({} as never);
    first.favorites.glazeIds.push('g1');
    first.buddies.incoming.push({} as never);
    expect(emptyAccountData()).toEqual({
      glazes: [],
      combinations: [],
      stock: [],
      clubs: [],
      clubMembers: {},
      clubWishlists: {},
      buddies: { buddies: [], incoming: [], outgoing: [], hasLink: false },
      buddyAvailability: { glazes: [], asOf: null },
      authorAvatars: {},
      favoriteCounts: { glazes: [], combinations: [] },
      favorites: { glazeIds: [], combinationIds: [] },
    });
  });
});

describe('formErrorFor', () => {
  it('answers the message of the named form only', () => {
    const formError = { form: clubForm('invite', 'c1'), message: 'Not allowed.' };
    expect(formErrorFor({ formError }, clubForm('invite', 'c1'))).toBe('Not allowed.');
    expect(formErrorFor({ formError }, clubForm('invite', 'c2'))).toBe('');
    expect(formErrorFor({ formError }, 'glaze')).toBe('');
    expect(formErrorFor({ formError: null }, 'glaze')).toBe('');
  });
});

describe('loadFailureOf', () => {
  it('maps unreachable, rate limited and server errors', () => {
    expect(loadFailureOf(new ApiError('unreachable'))).toBe('offline');
    expect(loadFailureOf(new ApiError('limited', 429))).toBe('rateLimited');
    expect(loadFailureOf(new ApiError('bad gateway', 502))).toBe('server');
    expect(loadFailureOf(new ApiError('error', 500))).toBe('server');
    expect(loadFailureOf(new Error('unexpected'))).toBe('server');
  });
});

describe('listStatus', () => {
  it('shows loading, not empty, until the load has finished', () => {
    expect(listStatus(true, [])).toBe('loading');
    expect(listStatus(false, [])).toBe('empty');
    expect(listStatus(true, [1])).toBe('items');
    expect(listStatus(false, [1])).toBe('items');
  });

  it('keeps a shown list on screen while it reloads', () => {
    expect(refreshing(true, [1])).toBe(true);
    expect(refreshing(true, [])).toBe(false);
    expect(refreshing(false, [1])).toBe(false);
  });
});

describe('withoutGlaze', () => {
  it('drops the glaze with its stock rows and favourite, keeping everything else', () => {
    const stock = (id: string, glazeId: string) => stockItem({ id, glazeId });
    const result = withoutGlaze(
      {
        glazes: [glaze({ id: 'g1' }), glaze({ id: 'g2' })],
        stock: [stock('s1', 'g1'), stock('s2', 'g2'), stock('s3', 'g1')],
        favorites: { glazeIds: ['g1', 'g2'], combinationIds: ['c1'] },
      },
      'g1',
    );
    expect(result).toEqual({
      glazes: [glaze({ id: 'g2' })],
      stock: [stock('s2', 'g2')],
      favorites: { glazeIds: ['g2'], combinationIds: ['c1'] },
    });
  });
});

describe('withImage', () => {
  const picture = (id: string) => ({ id, url: `/api/images/${id}` }) as never;
  const state = {
    glazes: [{ id: 'g1', images: [picture('i1'), picture('i2')] }] as never[],
    combinations: [
      { id: 'c1', images: [picture('i3')] },
      { id: 'c2', images: [] },
    ] as never[],
  };

  it('replaces a moved picture in place, wherever it is listed', () => {
    const moved = withImage(state, 'i2', picture('i9'));
    expect(moved.glazes).toEqual([{ id: 'g1', images: [picture('i1'), picture('i9')] }]);
    expect(moved.combinations[0]).toBe(state.combinations[0]);
    const combo = withImage(state, 'i3', picture('i3'));
    expect(combo.combinations[0]).toEqual({ id: 'c1', images: [picture('i3')] });
    expect(combo.glazes[0]).toBe(state.glazes[0]);
  });

  it('lists every shown picture URL', () => {
    expect(shownImageUrls(state)).toEqual(['/api/images/i1', '/api/images/i2', '/api/images/i3']);
  });
});

describe('termsPending', () => {
  const user = (acceptedTermsVersion?: string | null) =>
    ({
      id: 'u1',
      email: 'a@b.c',
      displayName: 'A',
      siteAdmin: false,
      acceptedTermsVersion,
    }) as User;

  it.each([
    ['no accepted version (before V9)', null, true],
    ['an older version', '2026-01-01', true],
    ['the current version', termsVersion, false],
    ['an unknown version saved on the device', undefined, false],
  ])('asks an account with %s', (_case, version, pending) => {
    expect(termsPending({ user: user(version), online: true, termsRequired: false })).toBe(pending);
  });

  it('asks after a refused write, but never guests or offline', () => {
    expect(termsPending({ user: user(termsVersion), online: true, termsRequired: true })).toBe(true);
    expect(termsPending({ user: user(undefined), online: true, termsRequired: true })).toBe(true);
    expect(termsPending({ user: user(null), online: false, termsRequired: true })).toBe(false);
    expect(termsPending({ user: null, online: true, termsRequired: true })).toBe(false);
  });
});

describe('withNewGlaze', () => {
  it('inserts the glaze and its entry in the API’s order and keeps the other items', () => {
    const blue = glaze({ id: 'g1', name: 'Blue', code: 'g1' });
    const zinc = glaze({ id: 'g3', name: 'Zinc', code: 'g3' });
    const botz = { id: 'm2', shortId: 'BOTZ', name: 'Botz' };
    const bluestock = stockItem({ id: 's1', glazeId: 'g1', manufacturer: 'Amaco', name: 'Blue' });
    const state = { glazes: [blue, zinc], stock: [bluestock] };
    const aqua = glaze({ id: 'g2', name: 'Aqua', code: 'g2' });
    const next = withNewGlaze(state, {
      id: 'g2',
      glaze: aqua,
      stock: [stockItem({ id: 's2', glazeId: 'g2', manufacturer: 'Amaco', name: 'Aqua' })],
    });
    expect(next.glazes.map((item) => item.id)).toEqual(['g2', 'g1', 'g3']);
    expect(next.glazes[1]).toBe(blue);
    expect(next.stock.map((item) => item.id)).toEqual(['s2', 's1']);
    expect(next.stock[1]).toBe(bluestock);
    // A glaze of another manufacturer sorts by manufacturer first; no entry means no new stock.
    const other = withNewGlaze(next, {
      id: 'g4',
      glaze: glaze({ id: 'g4', name: 'Red', code: 'g4', manufacturer: botz }),
      stock: [],
    });
    expect(other.glazes.map((item) => item.id)).toEqual(['g2', 'g1', 'g3', 'g4']);
    expect(other.stock).toEqual(next.stock);
  });

  it('is idempotent for an answer that arrives twice', () => {
    const created = {
      id: 'g2',
      glaze: glaze({ id: 'g2', name: 'Aqua', code: 'g2' }),
      stock: [stockItem({ id: 's2', glazeId: 'g2', manufacturer: 'Amaco', name: 'Aqua' })],
    };
    const once = withNewGlaze({ glazes: [], stock: [] }, created);
    const twice = withNewGlaze(once, created);
    expect(twice.glazes).toHaveLength(1);
    expect(twice.stock).toHaveLength(1);
  });
});

describe('withNewImage', () => {
  const picture = (id: string) => imageInfo({ id });
  const item = (id: string, ...images: string[]) => ({ id, images: images.map(picture) });

  it('puts the picture first on its glaze or combination only', () => {
    const state = {
      glazes: [item('g1', 'i1'), item('x')],
      combinations: [item('x', 'i2')],
    } as never;
    const onGlaze = withNewImage(state, { type: 'glaze', id: 'x' }, picture('i3'));
    expect(onGlaze.glazes[1].images.map((image) => image.id)).toEqual(['i3']);
    // The same ID on a combination is a different item.
    expect(onGlaze.combinations).toBe((state as { combinations: unknown }).combinations);
    expect(onGlaze.glazes[0]).toBe((state as { glazes: unknown[] }).glazes[0]);
    const onCombination = withNewImage(state, { type: 'combination', id: 'x' }, picture('i3'));
    expect(onCombination.combinations[0].images.map((image) => image.id)).toEqual(['i3', 'i2']);
  });

  it('ignores a target that is gone and a picture already listed', () => {
    const state = { glazes: [item('g1', 'i1')], combinations: [] } as never;
    expect(withNewImage(state, { type: 'glaze', id: 'gone' }, picture('i9')).glazes[0].images).toHaveLength(1);
    expect(withNewImage(state, { type: 'glaze', id: 'g1' }, picture('i1')).glazes[0].images).toHaveLength(1);
  });
});

describe('withCombinationTitle', () => {
  const first = combination({ id: 'c1', title: 'Old' });
  const second = combination({ id: 'c2', title: 'Other' });

  it('retitles that combination only, in place, and keeps the others as they were', () => {
    const next = withCombinationTitle({ combinations: [first, second] }, 'c1', 'New');
    expect(next.combinations.map((combo) => [combo.id, combo.title])).toEqual([
      ['c1', 'New'],
      ['c2', 'Other'],
    ]);
    expect(next.combinations[1]).toBe(second);
  });

  it('changes nothing for an unchanged title or a combination no longer listed', () => {
    const state = { combinations: [first, second] };
    expect(withCombinationTitle(state, 'c1', 'Old')).toBe(state);
    expect(withCombinationTitle(state, 'gone', 'New')).toBe(state);
  });
});

describe('withCorrectedGlaze', () => {
  const blue = glaze({ id: 'g1', name: 'Blue' });
  const red = glaze({ id: 'g2', name: 'Red' });
  const usesBlue = combination({ id: 'c1', steps: [glazeStep({ glazeId: 'g1', name: 'Blue' })] });
  const usesRed = combination({ id: 'c2', steps: [glazeStep({ glazeId: 'g2', name: 'Red' })] });
  const shelf = [stockItem({ id: 's1', glazeId: 'g1', name: 'Blue' }), stockItem({ id: 's2', glazeId: 'g2', name: 'Red' })];

  it('replaces the glaze in name order and renames its steps and shelf entries only', () => {
    const state = { glazes: [blue, red], combinations: [usesBlue, usesRed], stock: shelf };
    const next = withCorrectedGlaze(state, { ...blue, name: 'Teal', lastEditedBy: 'Ana', lastEditedAt: '2026-10-30T09:00:00Z' });
    expect(next.glazes.map((item) => [item.id, item.name])).toEqual([
      ['g2', 'Red'],
      ['g1', 'Teal'],
    ]);
    expect(next.glazes[1].lastEditedBy).toBe('Ana');
    expect(next.combinations[0].steps[0].name).toBe('Teal');
    expect(next.combinations[1]).toBe(usesRed);
    expect(next.stock.map((entry) => entry.name)).toEqual(['Teal', 'Red']);
    expect(next.stock[1]).toBe(shelf[1]);
  });

  it('keeps everything for a glaze no longer listed or a code-only change', () => {
    const state = { glazes: [red], combinations: [usesBlue], stock: shelf };
    expect(withCorrectedGlaze(state, blue)).toBe(state);
    const recoded = withCorrectedGlaze({ glazes: [blue], combinations: [usesBlue], stock: shelf }, { ...blue, code: 'PC-21' });
    expect(recoded.combinations[0]).toBe(usesBlue);
    expect(recoded.glazes[0].code).toBe('PC-21');
  });
});

describe('isGuest', () => {
  it('is true only for a settled session without an account', () => {
    expect(isGuest({ user: null, sync: { phase: 'idle', failure: null } })).toBe(true);
    expect(isGuest({ user: null, sync: INITIAL_SYNC })).toBe(false);
    expect(isGuest({ user: { id: 'u1', email: 'a@b.c', displayName: 'A', siteAdmin: false } as User, sync: { phase: 'idle', failure: null } })).toBe(false);
  });
});
