import { describe, expect, it } from 'vitest';
import { glaze, stockItem } from '../../test/fixtures';
import { DEFAULT_JAR_G } from './shelf';
import {
  lookingUp,
  newShelfScan,
  nextShelfJar,
  scanSheetFor,
  sheetChanged,
  sheetInput,
  sheetJar,
  sheetQuickInput,
  sheetUsedUpInput,
  stepSheet,
  steppedAmount,
  withShelfGlaze,
  withShelfOwner,
} from './scan-sheet';

const stock = [
  stockItem({ quantityG: 500, jarSizeG: 250, name: 'Blue Rutile' }),
  stockItem({ id: 's2', clubId: 'c1', clubName: 'Club', quantityG: 0, jarSizeG: null }),
];

describe('scanSheetFor', () => {
  it('starts from the entry of that shelf', () => {
    expect(scanSheetFor(stock, 'g1', 'personal')).toMatchObject({ amount: 500, jar: 250 });
    expect(scanSheetFor(stock, 'g1', 'c1')).toMatchObject({ amount: 0, jar: null });
  });

  it('starts at the default amount with the usual jar for a glaze that is not on the shelf', () => {
    const sheet = scanSheetFor(stock, 'g9', 'personal');
    expect(sheet).toMatchObject({ entry: undefined, amount: DEFAULT_JAR_G, jar: DEFAULT_JAR_G });
    expect(scanSheetFor(stock, 'g9', 'c1')).toMatchObject({ entry: undefined, amount: DEFAULT_JAR_G, jar: DEFAULT_JAR_G });
  });

  it('never sets a jar size on an existing entry that has none', () => {
    expect(scanSheetFor(stock, 'g1', 'c1').jar).toBeNull();
  });
});

describe('stepping by the jar size', () => {
  it('adds and removes one jar', () => {
    const sheet = scanSheetFor(stock, 'g1', 'personal');
    expect(stepSheet(sheet, 1).amount).toBe(750);
    expect(stepSheet(stepSheet(sheet, -1), -1).amount).toBe(0);
  });

  it('never goes below 0 g and stops at 0 g', () => {
    const sheet = { ...scanSheetFor(stock, 'g1', 'personal'), amount: 100 };
    expect(stepSheet(sheet, -1).amount).toBe(0);
    expect(steppedAmount({ ...sheet, amount: 0 }, -1)).toBeNull();
  });

  it('needs a valid jar size and amount', () => {
    const sheet = { ...scanSheetFor(stock, 'g9', 'personal'), jar: null };
    expect(sheetJar(sheet)).toBeNull();
    expect(stepSheet(sheet, 1)).toBe(sheet);
    expect(stepSheet({ ...sheet, jar: 0 }, 1)).toEqual({ ...sheet, jar: 0 });
    expect(stepSheet({ ...sheet, jar: 100, amount: null }, 1).amount).toBeNull();
    expect(stepSheet({ ...sheet, jar: 100 }, 1).amount).toBe(DEFAULT_JAR_G + 100);
  });

  it.each([
    [999_999_999, 1_000_000_000],
    [1_000_000_000, null],
  ])('steps %j g up to %j: the limit itself is allowed, beyond it is refused', (amount, next) => {
    expect(steppedAmount({ ...scanSheetFor(stock, 'g1', 'personal'), amount, jar: 1 }, 1)).toBe(next);
  });

  it('has no jar size below 1 g', () => {
    expect(sheetJar({ jar: 0 })).toBeNull();
    expect(sheetJar({ jar: 1 })).toBe(1);
  });

  it('refuses amounts above the limit', () => {
    const sheet = { ...scanSheetFor(stock, 'g1', 'personal'), amount: 1_000_000_000 };
    expect(steppedAmount(sheet, 1)).toBeNull();
  });
});

describe('sheetInput', () => {
  it('adds the jars of the + steps to what the server holds, keeping or storing the jar size', () => {
    const sheet = stepSheet(scanSheetFor(stock, 'g1', 'personal'), 1);
    expect(sheetInput(sheet)).toEqual({
      glazeId: 'g1',
      addG: 250,
      ownerType: 'personal',
      clubId: null,
      jarSizeG: 250,
    });
    expect(sheetInput(stepSheet(sheet, 1))).toMatchObject({ addG: 500 });
    const club = { ...scanSheetFor(stock, 'g1', 'c1'), jar: 100 };
    expect(sheetInput(stepSheet(club, 1))).toEqual({
      glazeId: 'g1',
      addG: 100,
      ownerType: 'club',
      clubId: 'c1',
      jarSizeG: 100,
    });
    // An empty jar size on the club entry: the typed one is stored, no replacement asked for.
    expect(sheetInput(stepSheet(club, 1))).not.toHaveProperty('replaceJarSize');
    // A glaze the shelf does not hold yet: the default amount is an addition too, so an entry another device made counts;
    // a + step adds one jar more.
    expect(sheetInput(scanSheetFor(stock, 'g9', 'c1'))).toStrictEqual({ glazeId: 'g9', addG: 250, jarSizeG: 250, ownerType: 'club', clubId: 'c1' });
    expect(sheetInput(stepSheet(scanSheetFor(stock, 'g9', 'personal'), 1))).toMatchObject({ glazeId: 'g9', addG: 500, jarSizeG: 250 });
  });

  it("replaces the entry's jar size only when it was changed in the sheet (STOCK-2)", () => {
    const sheet = scanSheetFor(stock, 'g1', 'personal');
    // Untouched (250 g, as the entry shows): never overwrites a size another device stored meanwhile.
    expect(sheetInput(stepSheet(sheet, 1))).not.toHaveProperty('replaceJarSize');
    expect(sheetInput(stepSheet({ ...sheet, jar: 1000 }, 1))).toEqual({
      glazeId: 'g1',
      addG: 1000,
      ownerType: 'personal',
      clubId: null,
      jarSizeG: 1000,
      replaceJarSize: true,
    });
    // A new entry's usual jar is no change the person made, nor a typed size on a glaze the shelf does not hold.
    expect(sheetInput(stepSheet({ ...scanSheetFor(stock, 'g9', 'personal'), jar: 500 }, 1))).not.toHaveProperty('replaceJarSize');
  });

  it('sets a typed amount, and one below what the shelf held', () => {
    const sheet = scanSheetFor(stock, 'g1', 'personal');
    // The jar size is unchanged, so it stays out: a size another device stored meanwhile is kept (FE-9).
    expect(sheetInput({ ...sheet, amount: 900, typed: true })).toEqual({
      glazeId: 'g1',
      quantityG: 900,
      ownerType: 'personal',
      clubId: null,
    });
    expect(sheetInput({ ...sheet, amount: 900, jar: 500, typed: true })).toMatchObject({ quantityG: 900, jarSizeG: 500 });
    // Only the jar size changed: a size-only save keeps the amount another device may have changed (STOCK-3).
    expect(sheetInput({ ...sheet, jar: 500 })).toEqual({ glazeId: 'g1', jarSizeG: 500, ownerType: 'personal', clubId: null });
    // Typing after a step sets as well.
    expect(sheetInput({ ...stepSheet(sheet, 1), typed: true })).toMatchObject({ quantityG: 750 });
    expect(sheetInput(stepSheet(sheet, -1))).toMatchObject({ quantityG: 250 });
    expect(sheetInput(sheet)).toMatchObject({ quantityG: 500 });
    // A shelf that held none: a typed amount is added, so an entry another device made meanwhile keeps its grams (FE-6).
    expect(sheetInput({ ...scanSheetFor(stock, 'g9', 'personal'), amount: 250, typed: true })).toEqual({
      glazeId: 'g9',
      addG: 250,
      jarSizeG: 250,
      ownerType: 'personal',
      clubId: null,
    });
  });

  it('is null while the fields are invalid', () => {
    const sheet = scanSheetFor(stock, 'g1', 'personal');
    expect(sheetInput({ ...sheet, amount: null })).toBeNull();
    expect(sheetInput({ ...sheet, amount: -5 })).toBeNull();
    expect(sheetInput({ ...sheet, jar: 0.5 })).toBeNull();
  });
});

describe('sheetUsedUpInput', () => {
  it('zeroes an entry that has some left, keeping its jar size out of the request', () => {
    const input = sheetUsedUpInput(scanSheetFor(stock, 'g1', 'personal'));
    expect(input).toEqual({ glazeId: 'g1', quantityG: 0, ownerType: 'personal', clubId: null });
  });

  it('offers the tap for an entry with a single gram left', () => {
    const sheet = scanSheetFor([stockItem({ quantityG: 1 })], 'g1', 'personal');
    expect(sheetUsedUpInput(sheet)).toMatchObject({ glazeId: 'g1', quantityG: 0 });
  });

  it('offers nothing for an empty or missing entry', () => {
    expect(sheetUsedUpInput(scanSheetFor(stock, 'g1', 'c1'))).toBeNull();
    expect(sheetUsedUpInput(scanSheetFor(stock, 'g9', 'personal'))).toBeNull();
  });
});

describe('sheetChanged', () => {
  it('is false as scanned and true after a step or a new jar size', () => {
    const sheet = scanSheetFor(stock, 'g1', 'personal');
    expect(sheetChanged(sheet)).toBe(false);
    expect(sheetChanged(stepSheet(sheet, 1))).toBe(true);
    expect(sheetChanged({ ...sheet, jar: 300 })).toBe(true);
    expect(sheetChanged({ ...sheet, amount: null })).toBe(true);
  });

  it('is false for a glaze not on the shelf while the default amount and jar are untouched', () => {
    const sheet = scanSheetFor(stock, 'g9', 'personal');
    expect(sheetChanged(sheet)).toBe(false);
    expect(sheetChanged({ ...sheet, typed: true })).toBe(false);
    expect(sheetChanged({ ...sheet, amount: 1 })).toBe(true);
    expect(sheetChanged({ ...sheet, amount: 0 })).toBe(true);
    expect(sheetChanged({ ...sheet, amount: null })).toBe(true);
    expect(sheetChanged(stepSheet(sheet, 1))).toBe(true);
    expect(sheetChanged({ ...sheet, jar: 500 })).toBe(true);
    expect(sheetChanged({ ...sheet, jar: null })).toBe(true);
  });
});

describe('shelf scan session', () => {
  const blue = glaze();

  it('starts on the personal shelf with nothing open', () => {
    expect(newShelfScan()).toEqual({
      owner: 'personal',
      lookup: null,
      glaze: null,
      sheet: null,
      note: '',
    });
  });

  it('starts on the shelf the page shows', () => {
    expect(newShelfScan('k1')).toMatchObject({ owner: 'k1', lookup: null, sheet: null });
  });

  it('shows the code being looked up and drops the previous note', () => {
    const scan = lookingUp({ ...newShelfScan(), note: 'Saved' }, '4006381333931');
    expect(scan).toMatchObject({ lookup: '4006381333931', note: '' });
  });

  it('opens the sheet of a known glaze on the kept shelf', () => {
    const scan = withShelfGlaze({ ...newShelfScan(), owner: 'c1', lookup: 'x' }, stock, blue);
    expect(scan.lookup).toBeNull();
    expect(scan.glaze).toBe(blue);
    expect(scan.sheet).toMatchObject({ glazeId: 'g1', owner: 'c1', amount: 0, jar: null });
  });

  it('moves the open sheet to another shelf and keeps the owner for the next jar', () => {
    const open = withShelfGlaze(newShelfScan(), stock, blue);
    const moved = withShelfOwner(open, stock, 'c1');
    expect(moved.owner).toBe('c1');
    expect(moved.sheet).toMatchObject({ owner: 'c1', entry: stock[1] });
    expect(nextShelfJar(moved, 'Saved')).toEqual({
      owner: 'c1',
      lookup: null,
      glaze: null,
      sheet: null,
      note: 'Saved',
    });
  });

  it('keeps no sheet when changing the shelf without an open glaze', () => {
    expect(withShelfOwner(newShelfScan(), stock, 'c1')).toMatchObject({ owner: 'c1', sheet: null });
  });
});

describe('sheetQuickInput', () => {
  it("is the default jar on the sheet's shelf while the shelf holds nothing of the glaze", () => {
    expect(sheetQuickInput(scanSheetFor([], 'g1', 'personal'))).toEqual({ glazeId: 'g1', addG: 250, ownerType: 'personal', clubId: null, jarSizeG: 250 });
    expect(sheetQuickInput(scanSheetFor([], 'g1', 'club-1'))).toMatchObject({ ownerType: 'club', clubId: 'club-1', addG: 250 });
  });

  it('is absent where an entry exists (its amount is edited instead)', () => {
    expect(sheetQuickInput(scanSheetFor(stock, 'g1', 'personal'))).toBeNull();
  });
});
