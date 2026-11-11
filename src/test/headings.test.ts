import { beforeAll, describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { setLocale } from '../lib/i18n';
import { combination, glaze } from './fixtures';
import CombinationCard from '../components/combinations/CombinationCard.svelte';
import GlazeCard from '../components/glazes/GlazeCard.svelte';
import SignInEmpty from '../components/auth/SignInEmpty.svelte';
import RouteStatus from '../components/routing/RouteStatus.svelte';

/** The heading tags of a server-rendered component, in document order. */
const headings = (body: string) => [...body.matchAll(/<(h[1-6])\b/g)].map((match) => match[1]);
const noop = () => {};
const card = { user: null, online: true, onAddPhoto: noop };

beforeAll(() => setLocale('en'));

describe('heading levels (one h1 per page)', () => {
  it('keeps list cards at h3 and makes a detail card the h1', () => {
    const glazeCard = { ...card, glaze: glaze(), pictures: { cover: null, thumbnails: [] }, favorite: false, onToggleFavorite: async () => true };
    expect(headings(render(GlazeCard, { props: glazeCard }).body)).toEqual(['h3']);
    expect(headings(render(GlazeCard, { props: { ...glazeCard, headingLevel: 1 } }).body)).toEqual(['h1']);
    const comboCard = { ...card, combo: combination(), glazes: new Map() };
    expect(headings(render(CombinationCard, { props: comboCard }).body)).toEqual(['h3']);
    expect(headings(render(CombinationCard, { props: { ...comboCard, headingLevel: 1 } }).body)).toEqual(['h1']);
  });

  it('puts a status under the page heading unless it stands alone', () => {
    expect(headings(render(RouteStatus, { props: { status: 'missing' } }).body)).toEqual(['h2']);
    expect(headings(render(RouteStatus, { props: { status: 'crashed', headingLevel: 1 } }).body)).toEqual(['h1']);
    expect(headings(render(SignInEmpty, { props: { title: 'Sign in', onSignIn: noop } }).body)).toEqual(['h2']);
  });
});
