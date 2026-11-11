import { describe, expect, it } from 'vitest';
import { suggestLabel, type LabelWord } from './label';
import { glaze } from '../../test/fixtures';

const word = (text: string, x = 100, y = 100, confidence = 95): LabelWord => ({
  text,
  confidence,
  bbox: { x0: x, y0: y, x1: x + 80, y1: y + 25 },
});
const blueRutile = glaze({ name: 'Blue Rutile' });
const other = { id: 'm2', shortId: 'OTHER', name: 'Other' };
const otherGlaze = (code = 'PC-20') => glaze({ manufacturer: other, code, name: 'Blue Rutile' });

describe('photo label suggestions', () => {
  it('reads a code and neighbouring name, and infers a unique library code family', () => {
    expect(suggestLabel({ text: '', words: [word('Iron', 100, 40), word('Lustre', 100, 70), word('PC-33')] }, [blueRutile])).toEqual({
      manufacturer: 'Amaco',
      name: 'Iron Lustre',
      code: 'PC-33',
    });
  });
  it('does not turn an uncertain word into a partial name', () => {
    expect(suggestLabel({ text: '', words: [word('Blue', 100, 60), word('stor', 185, 60, 29), word('PC-22')] }, []).name).toBe('');
  });
  it('keeps neighbouring label words but stops before a distant warning column', () => {
    const words = [word('PC-20'), word('Blue', 190), word('Rutile', 280), word('warning', 460, 100, 40)];
    expect(suggestLabel({ text: '', words }, []).name).toBe('Blue Rutile');
  });
  it('uses an exact catalog match but never chooses the first of conflicting manufacturers', () => {
    const input = { text: '', words: [word('pc20')] };
    expect(suggestLabel(input, [blueRutile])).toEqual({
      manufacturer: 'Amaco',
      name: 'Blue Rutile',
      code: 'PC-20',
    });
    expect(suggestLabel(input, [blueRutile, otherGlaze()]).manufacturer).toBe('');
  });
  it('recognises explicit brands and branded numeric codes without mistaking measurements for codes', () => {
    expect(suggestLabel({ text: 'BOTZ', words: [word('9020'), word('800'), word('ml')] }, [])).toMatchObject({ manufacturer: 'BOTZ', code: '9020' });
    expect(suggestLabel({ text: 'POTTER’S CHOICE', words: [word('PC-42')] }, [])).toMatchObject({
      manufacturer: 'Amaco',
      code: 'PC-42',
    });
    expect(suggestLabel({ text: 'Mayco', words: [word('SW-401')] }, [])).toMatchObject({
      manufacturer: 'Mayco',
      code: 'SW-401',
    });
    expect(suggestLabel({ text: '', words: [word('CONE-6'), word('472'), word('D48157')] }, []).code).toBe('');
  });
  it('leaves ambiguous or unreadable codes blank, without O/0 or I/1 substitutions', () => {
    expect(suggestLabel({ text: '', words: [word('PC-20'), word('PC-21')] }, []).code).toBe('');
    expect(suggestLabel({ text: '', words: [word('PC-2O')] }, []).code).toBe('');
    expect(suggestLabel({ text: '', words: [] }, [])).toEqual({
      manufacturer: '',
      name: '',
      code: '',
    });
  });
  it('does not guess a manufacturer from several brands or treat a jar quantity as its code', () => {
    expect(suggestLabel({ text: 'Amaco Mayco', words: [word('SW-401')] }, []).manufacturer).toBe('');
    expect(suggestLabel({ text: 'BOTZ', words: [word('9020'), word('ml', 185)] }, []).code).toBe('');
    expect(suggestLabel({ text: '', words: [word('472'), word('ml', 185)] }, [otherGlaze('472')]).code).toBe('');
  });
  it('rejects firing-text fragments and incomplete or fragmented names', () => {
    expect(suggestLabel({ text: '', words: [word('(ONES-6'), word('PC-42')] }, []).code).toBe('PC-42');
    expect(
      suggestLabel(
        {
          text: '',
          words: [word('Blue', 100, 40), word('Ru', 100, 70), word('le', 185, 70), word('PC-20')],
        },
        [],
      ).name,
    ).toBe('');
    const end = word('BIU®', 280, 80, 41);
    expect(suggestLabel({ text: '', words: [word('PC-21'), word('Arctic', 190, 90), end] }, []).name).toBe('');
  });
});
