import type { GlazeInput } from '../api/inputs';
import type { Glaze, Manufacturer } from '../api/models';
import { normalizeBarcode } from '../barcodes/barcodes';
import type { LabelSuggestion } from '../ocr/label';
import { DEFAULT_JAR_G } from '../stock/shelf';
import { filterManufacturers } from './glazes';

/** HTML patterns matching the API's checks (the API also allows surrounding spaces). */
export const shortIdPattern = '[A-Za-z][A-Za-z0-9]{1,9}';
export const codePattern = '[A-Za-z0-9]+([.\\-][A-Za-z0-9]+)*';
export const codeMaxLength = 40;
const canonicalCode = new RegExp('^(?:' + codePattern + ')$');

/** ECMAScript whitespace plus NEL matches Java's Unicode whitespace plus BOM. */
export function normalizeCode(code: string): string {
  return code
    .replace(/\u0085/gu, ' ')
    .trim()
    .toUpperCase()
    .replace(/[\s/-]+/gu, '-');
}

export function validCode(code: string): boolean {
  const normalized = normalizeCode(code);
  return normalized.length <= codeMaxLength && canonicalCode.test(normalized);
}

/** The add-glaze form: an existing manufacturer, or a new one added with the glaze. */
export interface GlazeDraft {
  /** The chosen manufacturer, or '' while none is chosen. */
  manufacturerId: string;
  newManufacturer: boolean;
  manufacturerName: string;
  shortId: string;
  /** Set once the short ID was typed, so it no longer follows the manufacturer name. */
  shortIdEdited: boolean;
  name: string;
  code: string;
  notes: string;
  /** Normalized tags, sent with the glaze. */
  tags: string[];
  /** "I have this glaze": the glaze goes on a shelf together with the library entry. */
  have: boolean;
  /** Grams on that shelf; undefined or null (a cleared number field binds null) while empty. */
  quantity: number | null | undefined;
  /** Grams per jar, optional; empty (undefined or null) in a new draft. */
  jarSize: number | null | undefined;
  /** Whose shelf: '' for the account's own, else a club id. */
  owner: string;
}

/**
 * The draft owner a host's shelf ("personal" or a club's ID) starts on: the club while the account is in it, else ''
 * (the personal shelf; also for a club the account left).
 */
export function draftOwnerFor(shelf: string | undefined, clubs: readonly { id: string }[]): string {
  return shelf && shelf !== 'personal' && clubs.some((club) => club.id === shelf) ? shelf : '';
}

/** `have` is the initial state of the shelf section (on from the stock page and scans), `owner` its shelf (`draftOwnerFor`). */
export function emptyGlazeDraft(have = false, owner = ''): GlazeDraft {
  return {
    manufacturerId: '',
    newManufacturer: false,
    manufacturerName: '',
    shortId: '',
    shortIdEdited: false,
    name: '',
    code: '',
    notes: '',
    tags: [],
    have,
    quantity: DEFAULT_JAR_G,
    jarSize: undefined,
    owner,
  };
}

export const maxJarSizeG = 100_000;

/** Whether the shelf part is complete: a whole number of grams, and a whole jar size when given. */
export function validShelf(draft: GlazeDraft): boolean {
  if (!draft.have) return true;
  const whole = (value: number | null | undefined, min: number, max: number) => value != null && Number.isInteger(value) && value >= min && value <= max;
  return whole(draft.quantity, 0, Number.MAX_SAFE_INTEGER) && (draft.jarSize == null || whole(draft.jarSize, 1, maxJarSizeG));
}

/** Typed shelf input that would be lost when the dialog closes (the section being on is not input). */
export function shelfTyped(draft: GlazeDraft): boolean {
  return draft.have && ((draft.quantity != null && draft.quantity !== DEFAULT_JAR_G) || draft.jarSize != null);
}

/** A short ID suggestion: the name's letters and digits without accents, upper case, at most 10. */
export function suggestShortId(name: string): string {
  return name
    .normalize('NFD')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/^[0-9]+/, '')
    .slice(0, 10);
}

/** Changes the new manufacturer's name; the short ID follows until it is typed. */
export function withManufacturerName(draft: GlazeDraft, name: string): GlazeDraft {
  return {
    ...draft,
    manufacturerName: name,
    shortId: draft.shortIdEdited ? draft.shortId : suggestShortId(name),
  };
}

/** The manufacturer name in front of the code input and its preview: the chosen or the new one. */
export function codePrefix(draft: GlazeDraft, manufacturers: Manufacturer[]): string {
  if (draft.newManufacturer) return draft.manufacturerName.trim();
  return manufacturers.find((manufacturer) => manufacturer.id === draft.manufacturerId)?.name ?? '';
}

/** Only a confirmed photo result reaches the draft; notes, tags and a manually chosen ID survive. */
export function withLabel(draft: GlazeDraft, label: LabelSuggestion, manufacturers: Manufacturer[]): GlazeDraft {
  const name = label.manufacturer.trim();
  const known = manufacturers.find((m) => [m.name, m.shortId].some((value) => value.toLowerCase() === name.toLowerCase()));
  const sameNew = draft.newManufacturer && draft.manufacturerName.toLowerCase() === name.toLowerCase();
  return {
    ...(known ? withExistingManufacturer(draft, known.id) : withManufacturerName({ ...draft, shortIdEdited: sameNew && draft.shortIdEdited }, name)),
    manufacturerId: known?.id ?? '',
    newManufacturer: !known,
    name: label.name.trim(),
    code: normalizeCode(label.code),
  };
}

/**
 * The request for a draft: the chosen manufacturer or the new one, never both. An optional barcode
 * (typed or scanned) is sent normalized; the API checks it again. A complete shelf part is sent as
 * `stock` and saved with the glaze.
 */
export function glazeInput(draft: GlazeDraft, barcode = ''): GlazeInput {
  const glaze = {
    name: draft.name.trim(),
    code: normalizeCode(draft.code),
    notes: draft.notes.trim() || undefined,
    tags: draft.tags,
    ...(draft.have && validShelf(draft)
      ? {
          stock: {
            quantityG: draft.quantity!,
            ...(draft.jarSize != null ? { jarSizeG: draft.jarSize } : {}),
            ...(draft.owner ? { clubId: draft.owner } : {}),
          },
        }
      : {}),
    ...(barcode.trim() ? { barcode: normalizeBarcode(barcode) ?? barcode.trim() } : {}),
  };
  return draft.newManufacturer
    ? {
        ...glaze,
        newManufacturer: {
          name: draft.manufacturerName.trim(),
          shortId: draft.shortId.trim().toUpperCase(),
        },
      }
    : { ...glaze, manufacturerId: draft.manufacturerId };
}

export type GlazeField = 'manufacturerName' | 'shortId' | 'name' | 'code' | 'notes' | 'barcode';

/** Server messages that concern one field of the add-glaze or edit-glaze form (English, as the API sends them). */
const fieldMessages: Record<string, GlazeField> = {
  'This manufacturer and glaze code already exist in the library.': 'code',
  'Combinations use this glaze, so only a site admin can change its code.': 'code',
  'Enter a glaze name of at most 120 characters': 'name',
  'Notes can have at most 1000 characters': 'notes',
  'This manufacturer ID is already taken.': 'shortId',
  'A manufacturer with this name already exists.': 'manufacturerName',
  'This barcode already belongs to another glaze.': 'barcode',
  'Enter an EAN-13, UPC-A or EAN-8 barcode with a valid check digit.': 'barcode',
};
/** Validation messages name the request field first ("code: …"). */
const fieldPrefixes: Record<string, GlazeField> = {
  'newManufacturer.name': 'manufacturerName',
  'newManufacturer.shortId': 'shortId',
  name: 'name',
  code: 'code',
  notes: 'notes',
  barcode: 'barcode',
};

/** The glaze form field a failed submit's message belongs to, or null for the form as a whole. */
export function glazeErrorField(message: string): GlazeField | null {
  if (fieldMessages[message]) return fieldMessages[message];
  const prefix = /^([\w.]+): /.exec(message)?.[1];
  return (prefix && fieldPrefixes[prefix]) || null;
}

/** Selecting an existing maker discards remembered new-maker details, not the glaze draft. */
export function withExistingManufacturer(draft: GlazeDraft, manufacturerId: string): GlazeDraft {
  return manufacturerId
    ? {
        ...draft,
        manufacturerId,
        newManufacturer: false,
        manufacturerName: '',
        shortId: '',
        shortIdEdited: false,
      }
    : { ...draft, manufacturerId: '' };
}

/** Only unmatched picker text prefills a new manufacturer; an existing choice clears old details. */
export function newManufacturerDraft(draft: GlazeDraft, typed: string, manufacturers: Manufacturer[]): GlazeDraft {
  const text = typed.trim();
  const unmatched = text && filterManufacturers(manufacturers, text).length === 0 ? text : '';
  const base = draft.manufacturerId ? { ...draft, manufacturerName: '', shortId: '', shortIdEdited: false } : draft;
  return withManufacturerName({ ...base, newManufacturer: true, manufacturerId: '' }, unmatched || base.manufacturerName);
}

/** An exact catalogue identity match; names do not determine a glaze's identity. */
export function duplicateGlaze(glazes: Glaze[], draft: GlazeDraft): Glaze | undefined {
  if (draft.newManufacturer || !draft.manufacturerId || !validCode(draft.code)) return undefined;
  const code = normalizeCode(draft.code);
  return glazes.find((glaze) => glaze.manufacturer.id === draft.manufacturerId && normalizeCode(glaze.code) === code);
}

const normalizedName = (name: string) => name.normalize('NFC').trim().toLowerCase().replace(/\s+/gu, ' ');

/** At most one insertion, deletion or substitution; linear work, no edit-distance matrix. */
function oneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let x = 0,
    y = 0,
    edits = 0;
  while (x < a.length && y < b.length) {
    if (a[x] === b[y]) {
      x++;
      y++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length >= b.length) x++;
    if (b.length >= a.length) y++;
  }
  return edits + Number(x < a.length || y < b.length) <= 1;
}

/** Same manufacturer: normalized exact names, or one edit for names of at least five characters.
 * Hints never block saving; at most three, ordered by exactness, name and ID.
 */
export function similarGlazes(glazes: Glaze[], draft: GlazeDraft): Glaze[] {
  if (draft.newManufacturer || !draft.manufacturerId) return [];
  const name = normalizedName(draft.name);
  if (name.length < 3) return [];
  return glazes
    .filter((glaze) => {
      if (glaze.manufacturer.id !== draft.manufacturerId) return false;
      const existing = normalizedName(glaze.name);
      return existing === name || (Math.min(name.length, existing.length) >= 5 && oneEdit(name, existing));
    })
    .sort(
      (a, b) =>
        Number(normalizedName(b.name) === name) - Number(normalizedName(a.name) === name) ||
        a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, 3);
}
