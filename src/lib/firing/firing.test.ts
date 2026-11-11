import { describe, expect, it } from 'vitest';
import { combination } from '../../test/fixtures';
import type { translate } from '../i18n';
import {
  clayBodySuggestions,
  compareCones,
  conesOf,
  firingDraft,
  firingInput,
  firingLine,
  firingSectionOpen,
  firingStarted,
  formatFiredOn,
  hasFiring,
  isCone,
} from './firing';

/** Renders keys with their values, so the tests read the line's structure. */
const t = ((key: string, options?: { values?: Record<string, unknown> }) =>
  options?.values ? `${key}(${Object.values(options.values).join(',')})` : key) as typeof translate;

describe('cones', () => {
  it('accepts an optional leading 0 and one or two digits, as the API does', () => {
    for (const cone of ['6', '10', '04', '022', ' 6 ', '42']) expect(isCone(cone)).toBe(true);
    for (const cone of ['', '0', '00', '006', '123', '6/7', 'cone 6', '6½', '-6', '6.5']) expect(isCone(cone)).toBe(false);
  });

  it('orders cones by heat: the 0 range descending first, then 1 upwards', () => {
    expect(['6', '04', '10', '022', '01', '1'].sort(compareCones)).toEqual(['022', '04', '01', '1', '6', '10']);
    expect(conesOf([combination({ cone: '6' }), combination({ cone: null }), combination({ cone: '04' }), combination({ cone: '6' })])).toEqual(['04', '6']);
  });
});

describe('the card line', () => {
  it('shows cone, short atmosphere and clay body in that order', () => {
    expect(
      firingLine(
        combination({
          cone: '6',
          temperatureC: 1222,
          atmosphere: 'OXIDATION',
          clayBody: 'Speckled stoneware',
          kiln: 'Club electric',
          firedOn: '2026-10-12',
        }),
        t,
      ),
    ).toBe('firing.line.cone(6) · firing.atmosphere.short.OXIDATION · Speckled stoneware');
  });

  it('falls back to the temperature without a cone and leaves out what is not recorded', () => {
    expect(firingLine(combination({ temperatureC: 1060, atmosphere: 'REDUCTION' }), t)).toBe(
      'firing.line.temperature(1060) · firing.atmosphere.short.REDUCTION',
    );
    expect(firingLine(combination({ clayBody: 'Porcelain' }), t)).toBe('Porcelain');
    expect(firingLine(combination({ atmosphere: 'OTHER' }), t)).toBe('firing.atmosphere.short.OTHER');
  });

  it('is empty without a final firing, also for kiln or date alone', () => {
    expect(firingLine(combination(), t)).toBe('');
    expect(firingLine(combination({ kiln: 'Gas', firedOn: '2026-01-01' }), t)).toBe('');
    expect(hasFiring(combination())).toBe(false);
    expect(hasFiring(combination({ kiln: 'Gas' }))).toBe(true);
  });
});

describe('the Studio section', () => {
  it('copies a combination into the form and back without changes', () => {
    const fired = combination({
      cone: '04',
      temperatureC: 1060,
      atmosphere: 'OTHER',
      clayBody: 'Earthenware',
      kiln: 'Raku',
      firedOn: '2026-05-01',
    });
    const draft = firingDraft(fired);
    expect(draft).toEqual({
      cone: '04',
      temperatureC: 1060,
      atmosphere: 'OTHER',
      clayBody: 'Earthenware',
      kiln: 'Raku',
      firedOn: '2026-05-01',
    });
    expect(firingInput(draft)).toEqual({
      cone: '04',
      temperatureC: 1060,
      atmosphere: 'OTHER',
      clayBody: 'Earthenware',
      kiln: 'Raku',
      firedOn: '2026-05-01',
    });
  });

  it('sends trimmed text and null for everything left empty', () => {
    expect(firingInput({ ...firingDraft(), cone: ' 6 ', clayBody: '  ', kiln: ' Gas ' })).toEqual({
      cone: '6',
      temperatureC: null,
      atmosphere: null,
      clayBody: null,
      kiln: 'Gas',
      firedOn: null,
    });
    expect(firingInput({ ...firingDraft(), temperatureC: Number.NaN }).temperatureC).toBeNull();
  });

  it('counts any filled field as started', () => {
    expect(firingStarted(firingDraft())).toBe(false);
    expect(firingStarted({ ...firingDraft(), clayBody: '   ' })).toBe(false);
    expect(firingStarted({ ...firingDraft(), atmosphere: 'REDUCTION' })).toBe(true);
    expect(firingStarted({ ...firingDraft(), temperatureC: 1222 })).toBe(true);
  });
});

describe('folded section', () => {
  it('stays open once a field is invalid, even if it was never opened (a resize or rotation after typing)', () => {
    expect(firingSectionOpen(false, true)).toBe(true);
    expect(firingSectionOpen(true, true)).toBe(true);
  });

  it('keeps the user choice while every field is valid', () => {
    expect(firingSectionOpen(false, false)).toBe(false);
    expect(firingSectionOpen(true, false)).toBe(true);
  });
});

describe('clay body suggestions', () => {
  it('offers each listed clay body once, most used first, then alphabetically', () => {
    expect(
      clayBodySuggestions([
        combination({ clayBody: 'Porcelain' }),
        combination({ clayBody: 'Speckled stoneware' }),
        combination({ clayBody: 'speckled stoneware ' }),
        combination({ clayBody: null }),
        combination({ clayBody: 'Buff' }),
      ]),
    ).toEqual(['Speckled stoneware', 'Buff', 'Porcelain']);
    expect(clayBodySuggestions([])).toEqual([]);
  });
});

describe('firing dates', () => {
  it('shows the stored day in every time zone', () => {
    expect(formatFiredOn('2026-10-12', 'en')).toBe('12 Oct 2026');
    expect(formatFiredOn('2026-10-12', 'de')).toBe('12.10.2026');
    expect(formatFiredOn('not a date', 'en')).toBe('not a date');
  });
});
