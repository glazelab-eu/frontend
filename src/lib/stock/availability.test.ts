import { beforeAll, describe, expect, it } from 'vitest';
import { loadLocale, translate, type Locale } from '../i18n';
import { club, stockItem } from '../../test/fixtures';
import { availabilityByGlaze, availabilityText, CLUB_NAME_MAX, shortClubName } from './availability';

const kiln = club({ id: 'c1', name: 'Kiln' });
const atelier = club({ id: 'c2', name: 'Atelier' });
const barn = club({ id: 'c3', name: 'Barn' });
const clay = club({ id: 'c4', name: 'Clay' });
const clubs = [kiln, atelier, barn, clay];
const inClub = (clubId: string, glazeId = 'g1', quantityG = 500) => stockItem({ id: `${clubId}-${glazeId}`, glazeId, clubId, quantityG });
const tr = (locale: Locale) => (key: Parameters<typeof translate>[0], options?: Parameters<typeof translate>[1]) => translate(key, { ...options, locale });
const text = (stock: Parameters<typeof availabilityByGlaze>[0], options = { clubs: true }, locale: Locale = 'en') =>
  availabilityText(availabilityByGlaze(stock, clubs, options).get('g1'), tr(locale), locale).text;

describe('shelf availability', () => {
  beforeAll(() => Promise.all([loadLocale('de'), loadLocale('pt-PT'), loadLocale('it'), loadLocale('es')]));

  it('says "On your shelf" for personal stock, also when clubs hold the glaze too', () => {
    expect(text([stockItem()])).toBe('On your shelf');
    expect(text([stockItem(), inClub('c1')])).toBe('On your shelf');
    expect(availabilityByGlaze([stockItem(), inClub('c1')], clubs, { clubs: true }).get('g1')).toEqual({ personal: true, clubs: [] });
  });

  it('names the club when only a club shelf holds the glaze', () => {
    expect(text([inClub('c1')])).toBe('Available in Kiln');
  });

  it('names two clubs by name and counts the rest from three on, sorted by name', () => {
    expect(text([inClub('c1'), inClub('c2')])).toBe('Available in Atelier and Kiln');
    expect(text([inClub('c1'), inClub('c2'), inClub('c3')])).toBe('Available in Atelier, Barn and 1 more');
    expect(text([inClub('c1'), inClub('c2'), inClub('c3'), inClub('c4')])).toBe('Available in Atelier, Barn and 2 more');
  });

  it('says "Not on your shelf" without stock, for used up entries and for a club the account left', () => {
    expect(text([])).toBe('Not on your shelf');
    expect(text([stockItem({ quantityG: 0 }), inClub('c1', 'g1', 0)])).toBe('Not on your shelf');
    expect(text([inClub('gone')])).toBe('Not on your shelf');
    // A used up personal entry does not hide the club that has it.
    expect(text([stockItem({ quantityG: 0 }), inClub('c1')])).toBe('Available in Kiln');
  });

  it('follows the scope: personal only never counts or names a club', () => {
    expect(text([inClub('c1')], { clubs: false })).toBe('Not on your shelf');
    expect(availabilityByGlaze([inClub('c1')], clubs, { clubs: false }).has('g1')).toBe(false);
    expect(text([stockItem(), inClub('c1')], { clubs: false })).toBe('On your shelf');
  });

  it('cuts long club names and keeps the full names for the tooltip', () => {
    const long = club({ id: 'c9', name: 'The Very Long Community Ceramics Studio of Lisbon' });
    const result = availabilityText(availabilityByGlaze([inClub('c9')], [long], { clubs: true }).get('g1'), tr('en'), 'en');
    expect(result.text).toBe(`Available in ${shortClubName(long.name)}`);
    expect(Array.from(shortClubName(long.name))).toHaveLength(CLUB_NAME_MAX);
    expect(shortClubName(long.name).endsWith('…')).toBe(true);
    expect(result.full).toBe(`Available in ${long.name}`);
    expect(availabilityText({ personal: false, clubs: ['Kiln'] }, tr('en'), 'en').full).toBe('');
  });

  it('never cuts a surrogate pair in half', () => {
    const name = '🏺'.repeat(30);
    expect(shortClubName(name)).toBe('🏺'.repeat(CLUB_NAME_MAX - 1) + '…');
    expect(shortClubName('Kiln')).toBe('Kiln');
  });

  it('words the marks in every language, singular and plural', () => {
    const one = [inClub('c1')];
    const two = [inClub('c1'), inClub('c2')];
    const three = [inClub('c1'), inClub('c2'), inClub('c3')];
    expect([text(one, undefined, 'de'), text(two, undefined, 'de'), text(three, undefined, 'de')]).toEqual([
      'Verfügbar im Regal von Kiln',
      'Verfügbar in den Regalen von Atelier und Kiln',
      'Verfügbar in den Regalen von Atelier, Barn und 1 weiteren',
    ]);
    expect([text(one, undefined, 'pt-PT'), text(two, undefined, 'pt-PT'), text(three, undefined, 'pt-PT')]).toEqual([
      'Disponível na prateleira de Kiln',
      'Disponível nas prateleiras de Atelier e Kiln',
      'Disponível nas prateleiras de Atelier, Barn e mais 1',
    ]);
    expect([text(one, undefined, 'it'), text(two, undefined, 'it')]).toEqual([
      'Disponibile nello scaffale di Kiln',
      'Disponibile negli scaffali di Atelier e Kiln',
    ]);
    expect([text(one, undefined, 'es'), text(two, undefined, 'es')]).toEqual([
      'Disponible en el estante de Kiln',
      'Disponible en los estantes de Atelier y Kiln',
    ]);
    expect(text([stockItem()], undefined, 'de')).toBe('In deinem Regal');
  });
});
