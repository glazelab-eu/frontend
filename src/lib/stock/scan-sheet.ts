import type { StockAddInput, StockInput, StockWrite } from '../api/inputs';
import type { Glaze, StockItem } from '../api/models';
import {
  DEFAULT_JAR_G,
  MAX_JAR_G,
  MAX_STOCK_G,
  changedOnly,
  changesJarSize,
  entryFor,
  isAddition,
  newEntryWrite,
  parseGrams,
  quickAddInput,
  stockAddFor,
  stockSetInput,
  usedUpInput,
} from './shelf';

/**
 * The sheet that opens after a scan on the stock page: one glaze on one shelf, its amount and the
 * jar size the large -/+ buttons move it by. Fields are numbers, or null while empty.
 */
export interface ScanSheet {
  glazeId: string;
  /** "personal" or a club's ID (the stock form's select value). */
  owner: string;
  /** What that shelf holds of the glaze, if anything. */
  entry: StockItem | undefined;
  amount: number | null;
  jar: number | null;
  /** The amount was typed (not only moved by the jar buttons): saving then sets it instead of adding the jars. */
  typed?: boolean;
}

/** The sheet for a glaze on a shelf: an existing entry starts from its amount and jar size, a new one from one usual jar. */
export function scanSheetFor(stock: StockItem[], glazeId: string, owner: string): ScanSheet {
  const entry = entryFor(stock, glazeId, owner);
  return {
    glazeId,
    owner,
    entry,
    amount: entry ? entry.quantityG : DEFAULT_JAR_G,
    // A new entry starts with the usual jar; an existing one keeps its own size, or none (saving must not set one unasked).
    jar: entry ? (entry.jarSizeG ?? null) : DEFAULT_JAR_G,
  };
}

/** The jar size the buttons use, or null while it is empty or invalid. */
export const sheetJar = (sheet: Pick<ScanSheet, 'jar'>): number | null => parseGrams(sheet.jar, { min: 1, max: MAX_JAR_G });

/** The amount after one jar more (1) or less (-1), never below 0; null when the buttons cannot work. */
export function steppedAmount(sheet: ScanSheet, direction: 1 | -1): number | null {
  const jar = sheetJar(sheet);
  const amount = parseGrams(sheet.amount);
  if (jar === null || amount === null) return null;
  const next = Math.max(0, amount + direction * jar);
  return next <= MAX_STOCK_G && next !== amount ? next : null;
}

/** Moves the amount by one jar; the sheet stays as it is when that is not possible. */
export function stepSheet(sheet: ScanSheet, direction: 1 | -1): ScanSheet {
  const amount = steppedAmount(sheet, direction);
  return amount === null ? sheet : { ...sheet, amount };
}

/**
 * The save for the sheet, or null while its amount or jar size is invalid. Only what the person changed goes out:
 * - on a shelf that held no entry when the sheet opened, the amount is added (`newEntryWrite`);
 * - more than the shelf held, reached by the + buttons alone, is an addition of the difference (the jars just scanned go
 *   on top of what the server holds, whatever this device last saw; a jar size changed in the sheet replaces the entry's,
 *   an untouched one never overwrites a size another device stored);
 * - a typed amount, and less than before, set the amount, with the jar size only when it was changed and without the
 *   amount when only the size changed (`changedOnly`, FE-9/STOCK-3).
 */
export function sheetInput(sheet: ScanSheet): StockWrite | null {
  const input = stockSetInput(sheet.glazeId, sheet.owner, sheet.amount, sheet.jar);
  if (!input) return null;
  const { entry } = sheet;
  if (!entry) return newEntryWrite(input);
  const quantityG = input.quantityG ?? entry.quantityG;
  if (sheet.typed || quantityG <= entry.quantityG) return changedOnly(input, entry.quantityG, entry.jarSizeG);
  return stockAddFor(
    { glazeId: sheet.glazeId, clubId: input.clubId ?? null },
    quantityG - entry.quantityG,
    input.jarSizeG,
    changesJarSize(entry, input.jarSizeG),
  );
}

/** "Used up" as one tap: 0 g on an entry that has some. Nothing on a shelf that holds none yet. */
export const sheetUsedUpInput = (sheet: ScanSheet): StockInput | null => (sheet.entry && sheet.entry.quantityG > 0 ? usedUpInput(sheet.entry) : null);

/** The one-click default jar for a glaze the sheet's shelf does not hold yet, or null where an entry exists (its amount is edited instead). */
export const sheetQuickInput = (sheet: ScanSheet): StockAddInput | null => (sheet.entry ? null : quickAddInput(sheet.glazeId, sheet.owner));

/**
 * Whether the sheet holds something the person would lose: for an existing entry, a save that changes the amount or
 * jar size; for a new one, an amount or jar other than the usual jar it starts with.
 */
export function sheetChanged(sheet: ScanSheet): boolean {
  const { entry } = sheet;
  if (!entry) return sheet.amount !== DEFAULT_JAR_G || sheet.jar !== DEFAULT_JAR_G;
  const input = sheetInput(sheet);
  if (!input) return true;
  // An addition always adds grams.
  if (isAddition(input)) return true;
  const newJar = !!input.jarSizeG && input.jarSizeG !== entry.jarSizeG;
  if (input.quantityG === undefined || input.quantityG === null) return newJar;
  return input.quantityG !== entry.quantityG || newJar;
}

/**
 * The scan-first session on phones: the scanner stays open between jars. `lookup` is the code being
 * looked up, `glaze` and `sheet` the known glaze's open sheet, `owner` the shelf kept from jar to
 * jar and `note` what the last jar did.
 */
export interface ShelfScan {
  owner: string;
  lookup: string | null;
  glaze: Glaze | null;
  sheet: ScanSheet | null;
  note: string;
}

/** A session at its first jar, on the personal shelf or the shelf the page shows. */
export const newShelfScan = (owner = 'personal'): ShelfScan => ({
  owner,
  lookup: null,
  glaze: null,
  sheet: null,
  note: '',
});

/** The session while `code` is looked up. */
export const lookingUp = (scan: ShelfScan, code: string): ShelfScan => ({
  ...scan,
  lookup: code,
  note: '',
});

/** Ready for the next jar: nothing open, `note` says what the last one did. */
export const nextShelfJar = (scan: ShelfScan, note = ''): ShelfScan => ({
  ...scan,
  lookup: null,
  glaze: null,
  sheet: null,
  note,
});

/** The session with the sheet of a known glaze on the session's shelf. */
export const withShelfGlaze = (scan: ShelfScan, stock: StockItem[], glaze: Glaze): ShelfScan => ({
  ...scan,
  lookup: null,
  glaze,
  sheet: scanSheetFor(stock, glaze.id, scan.owner),
});

/** The session on another shelf: the sheet of the open glaze starts from what that shelf holds. */
export const withShelfOwner = (scan: ShelfScan, stock: StockItem[], owner: string): ShelfScan => ({
  ...scan,
  owner,
  sheet: scan.glaze ? scanSheetFor(stock, scan.glaze.id, owner) : scan.sheet,
});
