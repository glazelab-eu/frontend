import { describe, expect, it } from 'vitest';
import {
  codePattern,
  normalizeCode,
  validCode,
  duplicateGlaze,
  similarGlazes,
  newManufacturerDraft,
  withExistingManufacturer,
  codePrefix,
  draftOwnerFor,
  emptyGlazeDraft,
  glazeErrorField,
  glazeInput,
  shelfTyped,
  shortIdPattern,
  validShelf,
  suggestShortId,
  withManufacturerName,
  withLabel,
} from './glaze-form';

import cases from './code-cases.json';
import type { Glaze } from '../api/models';

const manufacturers = [{ id: 'm1', shortId: 'AMACO', name: 'Amaco' }];
// Browsers anchor the pattern attribute and compile it with the v flag.
const matches = (pattern: string, value: string) => new RegExp(`^(?:${pattern})$`, 'v').test(value);

describe('the amount of a new shelf entry', () => {
  it('starts with the usual jar of 250 g, which is not typed input to lose', () => {
    const draft = emptyGlazeDraft(true);
    expect(draft.quantity).toBe(250);
    expect(draft.jarSize).toBeUndefined();
    expect(shelfTyped(draft)).toBe(false);
    expect(shelfTyped({ ...draft, quantity: 100 })).toBe(true);
    expect(shelfTyped({ ...draft, jarSize: 500 })).toBe(true);
  });

  it('is sent as it stands, and can be changed', () => {
    const base = { ...emptyGlazeDraft(true), manufacturerId: 'm1', name: 'Blue', code: 'pc-20' };
    expect(glazeInput(base).stock).toEqual({ quantityG: 250 });
    expect(glazeInput({ ...base, quantity: 100 }).stock).toEqual({ quantityG: 100 });
    expect(glazeInput({ ...base, quantity: 100, jarSize: 1000 }).stock).toEqual({ quantityG: 100, jarSizeG: 1000 });
  });
});

describe('the shelf a new glaze starts on', () => {
  const clubs = [{ id: 'c1' }, { id: 'c2' }];

  it('is the club the host shows, sent with the stock, and not typed input', () => {
    const draft = emptyGlazeDraft(true, draftOwnerFor('c2', clubs));
    expect(draft).toMatchObject({ have: true, quantity: 250, owner: 'c2' });
    expect(shelfTyped(draft)).toBe(false);
    expect(glazeInput({ ...draft, manufacturerId: 'm1', name: 'Blue', code: 'pc-20' }).stock).toEqual({ quantityG: 250, clubId: 'c2' });
  });

  it.each([
    ['no shelf', undefined],
    ['the personal shelf', 'personal'],
    ['a club the account is not in (left)', 'gone'],
    ['nothing', ''],
  ])('is the personal one for %s', (_, shown) => {
    expect(draftOwnerFor(shown, clubs)).toBe('');
    expect(emptyGlazeDraft(true).owner).toBe('');
  });
});

describe('glaze form', () => {
  it('applies confirmed label details without losing notes or tags, using an existing manufacturer', () => {
    const draft = { ...emptyGlazeDraft(), notes: 'My notes', tags: ['blue'] };
    const changed = withLabel(draft, { manufacturer: ' amaco ', name: 'Seaweed', code: 'pc-42' }, manufacturers);
    expect(changed).toMatchObject({
      manufacturerId: 'm1',
      newManufacturer: false,
      name: 'Seaweed',
      code: 'PC-42',
      notes: 'My notes',
      tags: ['blue'],
    });
    expect(draft.name).toBe('');
  });
  it('prepares a new manufacturer and preserves its manually edited short ID on the same name', () => {
    const label = { manufacturer: 'New Ceramics', name: 'Blue', code: '42' };
    const changed = withLabel(emptyGlazeDraft(), label, manufacturers);
    expect(changed).toMatchObject({
      newManufacturer: true,
      manufacturerName: 'New Ceramics',
      shortId: 'NEWCERAMIC',
      manufacturerId: '',
    });
    expect(withLabel({ ...changed, shortId: 'NC', shortIdEdited: true }, label, manufacturers).shortId).toBe('NC');
  });
  it.each(['Mayco', ' mayco ', 'MAYC', 'mayc'])('recognises the known manufacturer by its name or its short ID: label %j', (manufacturer) => {
    const known = [{ id: 'm2', shortId: 'MAYC', name: 'Mayco' }];
    expect(withLabel(emptyGlazeDraft(), { manufacturer, name: 'Blue', code: '1' }, known)).toMatchObject({ manufacturerId: 'm2', newManufacturer: false });
  });
  it.each([
    ['the same new manufacturer', { newManufacturer: true, manufacturerName: 'New Ceramics' }, 'NC'],
    ['another new manufacturer', { newManufacturer: true, manufacturerName: 'Other Pots' }, 'NEWCERAMIC'],
    ['a manufacturer that is not new', { newManufacturer: false, manufacturerName: 'New Ceramics' }, 'NEWCERAMIC'],
  ])('keeps a hand-edited short ID only for %s', (_case, draft, shortId) => {
    const label = { manufacturer: 'New Ceramics', name: 'Blue', code: '42' };
    expect(withLabel({ ...emptyGlazeDraft(), ...draft, shortId: 'NC', shortIdEdited: true }, label, manufacturers).shortId).toBe(shortId);
  });
  it('sends an existing manufacturer with a normalized code', () => {
    const draft = {
      ...emptyGlazeDraft(),
      manufacturerId: 'm1',
      name: ' Blue Rutile ',
      code: ' pc-20 ',
      notes: '  ',
      tags: ['satin-matte'],
    };
    expect(glazeInput(draft)).toEqual({
      manufacturerId: 'm1',
      name: 'Blue Rutile',
      code: 'PC-20',
      notes: undefined,
      tags: ['satin-matte'],
    });
    expect(codePrefix(draft, manufacturers)).toBe('Amaco');
  });

  it('sends a new manufacturer instead of an ID', () => {
    const draft = {
      ...withManufacturerName({ ...emptyGlazeDraft(), newManufacturer: true }, ' Botz '),
      manufacturerId: 'm1',
      name: 'Seladon',
      code: '9353',
      notes: 'Cone 6',
    };
    expect(glazeInput(draft)).toEqual({
      newManufacturer: { name: 'Botz', shortId: 'BOTZ' },
      name: 'Seladon',
      code: '9353',
      notes: 'Cone 6',
      tags: [],
    });
    expect(codePrefix(draft, manufacturers)).toBe('Botz');
  });

  it('sends a typed or scanned barcode normalized, and none when it is empty', () => {
    const draft = { ...emptyGlazeDraft(), manufacturerId: 'm1', name: 'Blue', code: 'pc-20' };
    expect(glazeInput(draft, ' 0 36000 29145 2 ').barcode).toBe('0036000291452');
    expect(glazeInput(draft, '  ')).not.toHaveProperty('barcode');
    expect(glazeInput(draft)).not.toHaveProperty('barcode');
  });

  it('puts a barcode the dialog was opened for into the request as typed in the pre-filled field', () => {
    const filled = { ...emptyGlazeDraft(), manufacturerId: 'm1', name: 'Blue', code: 'pc 20' };
    expect(glazeInput(filled, '4006381333931')).toMatchObject({
      manufacturerId: 'm1',
      code: 'PC-20',
      barcode: '4006381333931',
    });
    expect(glazeInput(filled, '')).not.toHaveProperty('barcode');
  });

  it('suggests a short ID from the name until one is typed', () => {
    const draft = withManufacturerName({ ...emptyGlazeDraft(), newManufacturer: true }, 'Café Crème Company');
    expect(draft.shortId).toBe('CAFECREMEC');
    const typed = { ...draft, shortId: 'ccc', shortIdEdited: true };
    expect(withManufacturerName(typed, 'Café Crème').shortId).toBe('ccc');
    expect(codePrefix(typed, manufacturers)).toBe('Café Crème Company');
    expect(suggestShortId('3D Glaze')).toBe('DGLAZE');
  });

  it('has no prefix before a manufacturer is chosen', () => {
    expect(codePrefix(emptyGlazeDraft(), manufacturers)).toBe('');
  });

  it('checks short IDs and codes like the API', () => {
    for (const valid of ['AMACO', 'botz', 'B2', 'ABCDEFGHIJ']) expect(matches(shortIdPattern, valid), valid).toBe(true);
    for (const invalid of ['A', '1AB', 'AB-C', 'ÄBC', 'ABCDEFGHIJK']) expect(matches(shortIdPattern, invalid), invalid).toBe(false);
    for (const valid of ['PC-20', '9353', 'sw-101', 'BO-9.1', 'MBG120']) expect(matches(codePattern, valid), valid).toBe(true);
    for (const invalid of ['PC 20', 'PC--20', '-20', 'PC-', 'PC_20']) expect(matches(codePattern, invalid), invalid).toBe(false);
  });
});

describe('"I have this glaze" section', () => {
  const base = { ...emptyGlazeDraft(), manufacturerId: 'm1', name: 'Blue', code: 'PC-20' };

  it('starts on only when the host asks for it, with nothing typed', () => {
    expect(emptyGlazeDraft().have).toBe(false);
    const on = emptyGlazeDraft(true);
    expect(on).toMatchObject({ have: true, quantity: 250, jarSize: undefined, owner: '' });
    expect(shelfTyped(on)).toBe(false);
    expect(shelfTyped({ ...on, quantity: 450 })).toBe(true);
    expect(shelfTyped({ ...on, jarSize: 500 })).toBe(true);
    expect(shelfTyped({ ...base, have: false, quantity: 450 })).toBe(false);
  });

  it('sends a stock part only when the section is on and complete', () => {
    expect(glazeInput(base)).not.toHaveProperty('stock');
    expect(glazeInput({ ...base, quantity: 450 })).not.toHaveProperty('stock');
    expect(glazeInput({ ...base, have: true, quantity: undefined })).not.toHaveProperty('stock');
    expect(glazeInput({ ...base, have: true }).stock).toEqual({ quantityG: 250 });
    expect(glazeInput({ ...base, have: true, quantity: 450 }).stock).toEqual({ quantityG: 450 });
    expect(glazeInput({ ...base, have: true, quantity: 0, jarSize: 500, owner: 'c1' }).stock).toEqual({ quantityG: 0, jarSizeG: 500, clubId: 'c1' });
  });

  it('checks whole grams and the API’s jar size range', () => {
    const on = { ...base, have: true };
    expect(validShelf({ ...base, quantity: -5 })).toBe(true);
    expect(validShelf({ ...on, quantity: undefined })).toBe(false);
    expect(validShelf(on)).toBe(true);
    expect(validShelf({ ...on, quantity: -1 })).toBe(false);
    expect(validShelf({ ...on, quantity: 1.5 })).toBe(false);
    expect(validShelf({ ...on, quantity: 0 })).toBe(true);
    expect(validShelf({ ...on, quantity: 10, jarSize: 0 })).toBe(false);
    expect(validShelf({ ...on, quantity: 10, jarSize: 100_001 })).toBe(false);
    expect(validShelf({ ...on, quantity: 10, jarSize: 100_000 })).toBe(true);
  });

  // A number field that was typed in and cleared again binds null, not undefined.
  it('treats a cleared jar size as not given', () => {
    const on = { ...base, have: true, quantity: 100, jarSize: null };
    expect(validShelf(on)).toBe(true);
    expect(shelfTyped({ ...on, quantity: 250 })).toBe(false);
    expect(glazeInput(on).stock).toEqual({ quantityG: 100 });
  });

  it('treats a cleared amount as missing, not as typed input', () => {
    const on = { ...base, have: true, quantity: null };
    expect(validShelf(on)).toBe(false);
    expect(shelfTyped(on)).toBe(false);
    expect(glazeInput(on)).not.toHaveProperty('stock');
  });
});

describe('add-glaze errors', () => {
  it.each([
    ['This manufacturer and glaze code already exist in the library.', 'code'],
    ['This manufacturer ID is already taken.', 'shortId'],
    ['A manufacturer with this name already exists.', 'manufacturerName'],
    ['This barcode already belongs to another glaze.', 'barcode'],
    ['Enter an EAN-13, UPC-A or EAN-8 barcode with a valid check digit.', 'barcode'],
    ['code: Use letters and digits for the glaze code, such as PC-20', 'code'],
    ['newManufacturer.shortId: Use a manufacturer ID of 2 to 10 letters', 'shortId'],
    ['newManufacturer.name: must not be blank', 'manufacturerName'],
    ['name: must not be blank', 'name'],
    ['Too many requests. Please wait a moment and try again.', null],
    ['errors.generic', null],
    ['tags[0]: size must be between 0 and 100', null],
  ])('%s -> %s', (message, field) => {
    expect(glazeErrorField(message)).toBe(field);
  });
});

describe('printed code normalization', () => {
  it.each(cases)('normalizes $input as $normalized (valid=$valid)', ({ input, normalized, valid }) => {
    expect(normalizeCode(input)).toBe(normalized);
    expect(validCode(input)).toBe(valid);
  });
  it('uses the same canonical value in the request, label confirmation and live duplicate identity', () => {
    const draft = {
      ...emptyGlazeDraft(),
      manufacturerId: 'm1',
      code: ' pc /-- 20 ',
      notes: 'Keep me',
    };
    expect(glazeInput(draft).code).toBe('PC-20');
    expect(withLabel(draft, { manufacturer: 'Amaco', name: 'Blue', code: ' pc / 20 ' }, manufacturers)).toMatchObject({ code: 'PC-20', notes: 'Keep me' });
  });
});

const knownGlaze = (id: string, code: string, name = 'Blue Rutile', manufacturer = manufacturers[0]): Glaze => ({
  id,
  code,
  name,
  manufacturer,
  notes: null,
  images: [],
  tags: [],
  barcodes: [],
  createdAt: '2026-10-28T12:00:00Z',
  addedBy: 'Ana',
  lastEditedAt: null,
  lastEditedBy: null,
});
const selected = () => ({ ...emptyGlazeDraft(), manufacturerId: 'm1' });

describe('live duplicate and near-name checks', () => {
  it('matches manufacturer plus normalized code, independently of name and input format', () => {
    const glaze = knownGlaze('g1', 'PC-20');
    for (const code of ['pc 20', ' PC /-- 20 ', 'PC-20']) expect(duplicateGlaze([glaze], { ...selected(), code, name: 'Something different' })).toBe(glaze);
    expect(duplicateGlaze([glaze], { ...selected(), code: 'PC-21', name: glaze.name })).toBeUndefined();
    expect(duplicateGlaze([glaze], { ...selected(), code: 'PC-20', manufacturerId: 'm2' })).toBeUndefined();
    expect(duplicateGlaze([glaze], { ...selected(), code: 'PC_20' })).toBeUndefined();
    expect(duplicateGlaze([glaze], { ...selected(), code: 'PC-20', newManufacturer: true })).toBeUndefined();
  });
  it('hints normalized exact names or one edit, only within the manufacturer, and ignores short fuzzy names', () => {
    const glazes = [
      knownGlaze('exact', 'PC-1', ' Blue  Rutile '),
      knownGlaze('insert', 'PC-2', 'Blue Rutilex'),
      knownGlaze('delete', 'PC-3', 'Blue Rutil'),
      knownGlaze('swap', 'PC-4', 'Blue Rutlie'),
      knownGlaze('other', 'PC-5', 'Blue Rutile', { id: 'm2', name: 'Other', shortId: 'OTHER' }),
    ];
    const hints = similarGlazes(glazes, { ...selected(), name: 'blue rutile' });
    expect(hints[0].id).toBe('exact');
    expect(hints.map((glaze) => glaze.id).sort()).toEqual(['delete', 'exact', 'insert']);
    expect(similarGlazes([knownGlaze('short', 'PC-1', 'Blue')], { ...selected(), name: 'Blues' })).toEqual([]);
    expect(similarGlazes([knownGlaze('short', 'PC-1', 'Blue')], { ...selected(), name: 'blue ' })).toHaveLength(1);
    expect(similarGlazes(glazes, { ...selected(), name: 'bl' })).toEqual([]);
    expect(similarGlazes(glazes, { ...selected(), name: 'Blue Rutile', newManufacturer: true })).toEqual([]);
  });
  it.each([
    ['rutile', 'Rutile', true, 'the same name'],
    ['rutale', 'Rutile', true, 'one substitution inside'],
    ['xutile', 'Rutile', true, 'one substitution at the start'],
    ['rutilx', 'Rutile', true, 'one substitution at the end'],
    ['rutiles', 'Rutile', true, 'one insertion at the end'],
    ['xrutile', 'Rutile', true, 'one insertion at the start'],
    ['rutxile', 'Rutile', true, 'one insertion inside'],
    ['rutil', 'Rutile', true, 'one deletion at the end'],
    ['utile', 'Rutile', true, 'one deletion at the start'],
    ['rutle', 'Rutile', true, 'one deletion inside'],
    ['rxtale', 'Rutile', false, 'two substitutions'],
    ['rxtiles', 'Rutile', false, 'a substitution and an insertion'],
    ['rutilexy', 'Rutile', false, 'two insertions'],
    ['rtil', 'Rutile', false, 'two deletions'],
    ['rutile', 'Rutilexy', false, 'a stored name two characters longer'],
    ['blues', 'Blued', true, 'five characters: the shortest names that may differ'],
    ['blue', 'Blux', false, 'four characters: only exact names count'],
    ['bl', 'Bl', false, 'a typed name of two characters is too short to hint, even if exact'],
    ['blu', 'Blu', true, 'a typed name of three characters hints when exact'],
  ])('hints a stored name only when it is the same or one edit apart: typed %j, stored %j -> %s (%s)', (typed, stored, hinted) => {
    const hints = similarGlazes([knownGlaze('g1', 'PC-1', stored)], { ...selected(), name: typed });
    expect(hints.map((glaze) => glaze.id)).toEqual(hinted ? ['g1'] : []);
  });
  it('orders hints by exactness, then by name, then by ID', () => {
    const glazes = [
      knownGlaze('a1', 'PC-1', 'Rutilz'),
      knownGlaze('z1', 'PC-2', 'Rutilb'),
      knownGlaze('m2', 'PC-3', 'Rutile'),
      knownGlaze('m1', 'PC-4', 'Rutile'),
    ];
    expect(similarGlazes(glazes, { ...selected(), name: 'Rutile' }).map((glaze) => glaze.id)).toEqual(['m1', 'm2', 'z1']);
    expect(similarGlazes(glazes.slice(0, 2), { ...selected(), name: 'Rutilx' }).map((glaze) => glaze.id)).toEqual(['z1', 'a1']);
  });
  it('limits hints to three deterministically and normalizes Unicode names without changing displayed content', () => {
    const glazes = ['d', 'c', 'b', 'a'].map((id) => knownGlaze(id, id, 'Café Blue'));
    expect(similarGlazes(glazes, { ...selected(), name: 'Cafe\u0301 Blue' }).map((glaze) => glaze.id)).toEqual(['a', 'b', 'c']);
    expect(similarGlazes([...glazes].reverse(), { ...selected(), name: 'Café Blue' }).map((glaze) => glaze.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('new manufacturer prefill', () => {
  it('uses unmatched text but never a partial match or a previously chosen manufacturer', () => {
    expect(newManufacturerDraft(emptyGlazeDraft(), '  Laguna Ceramics ', manufacturers)).toMatchObject({
      newManufacturer: true,
      manufacturerId: '',
      manufacturerName: 'Laguna Ceramics',
      shortId: 'LAGUNACERA',
    });
    expect(newManufacturerDraft(emptyGlazeDraft(), 'ama', manufacturers).manufacturerName).toBe('');
    const chosen = withExistingManufacturer(
      {
        ...emptyGlazeDraft(),
        manufacturerName: 'Old name',
        shortId: 'OLD',
        shortIdEdited: true,
        name: 'Keep glaze',
        code: '20',
      },
      'm1',
    );
    expect(chosen).toMatchObject({
      manufacturerName: '',
      shortId: '',
      shortIdEdited: false,
      name: 'Keep glaze',
      code: '20',
    });
    expect(newManufacturerDraft(chosen, '', manufacturers).manufacturerName).toBe('');
    const fromLabel = withLabel(emptyGlazeDraft(), { manufacturer: 'Amaco', name: 'Blue', code: '20' }, manufacturers);
    expect(newManufacturerDraft(fromLabel, '', manufacturers).manufacturerName).toBe('');
  });
  it('suggests a fresh short ID for typed text that replaces a chosen manufacturer, whatever ID was edited before', () => {
    const chosen = { ...emptyGlazeDraft(), manufacturerId: 'm1', shortId: 'OLD', shortIdEdited: true };
    expect(newManufacturerDraft(chosen, 'Laguna Ceramics', manufacturers)).toMatchObject({
      manufacturerId: '',
      manufacturerName: 'Laguna Ceramics',
      shortId: 'LAGUNACERA',
      shortIdEdited: false,
    });
  });
  it('keeps an explicitly typed new manufacturer and manual ID when toggling without an existing choice', () => {
    const draft = {
      ...emptyGlazeDraft(),
      manufacturerName: 'My maker',
      shortId: 'MM',
      shortIdEdited: true,
    };
    expect(newManufacturerDraft(draft, '', manufacturers)).toMatchObject({
      manufacturerName: 'My maker',
      shortId: 'MM',
      shortIdEdited: true,
    });
  });
});
