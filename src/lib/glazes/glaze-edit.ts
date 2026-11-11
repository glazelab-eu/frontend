import type { GlazeChange } from '../api/inputs';
import type { Combination, Glaze, GlazeEdit, User } from '../api/models';
import type { MessageKey } from '../i18n/messages';
import { normalizeCode } from './glaze-form';
import { usesGlaze } from './steps';

/** The API's limits of a correction (`GlazeCorrection`), as on creation. */
export const maxGlazeName = 120;
export const maxGlazeNotes = 1000;

/** The edit dialog's fields, as typed. */
export interface GlazeEditDraft {
  name: string;
  code: string;
  notes: string;
}

export function glazeEditDraft(glaze: Pick<Glaze, 'name' | 'code' | 'notes'>): GlazeEditDraft {
  return { name: glaze.name, code: glaze.code, notes: glaze.notes ?? '' };
}

/**
 * Whether the account may change the glaze's code: site admins always, everyone else while no glaze step of
 * the combinations it can see (published ones and its own drafts) uses the glaze. Only a hint: drafts of others
 * count on the server too, which then answers 403.
 */
export function codeEditable(glazeId: string, user: Pick<User, 'siteAdmin'> | null, combinations: Combination[]): boolean {
  return !!user && (user.siteAdmin || !combinations.some((combo) => usesGlaze(combo, glazeId)));
}

/**
 * The correction to send: only the fields that differ from the glaze (the API keeps what is absent), the
 * name trimmed, the code normalized, blank notes as explicit null (the API clears on null). A field left as
 * it was is never sent, even when the stored value predates these rules (an older code with a space, notes
 * saved untrimmed). Null when nothing changed.
 */
export function glazeCorrection(glaze: Pick<Glaze, 'name' | 'code' | 'notes'>, draft: GlazeEditDraft): GlazeChange | null {
  const change: GlazeChange = {};
  const stored = glazeEditDraft(glaze);
  const name = draft.name.trim();
  const code = normalizeCode(draft.code);
  const notes = draft.notes.trim() || null;
  if (draft.name !== stored.name && name !== glaze.name) change.name = name;
  if (draft.code !== stored.code && code !== glaze.code) change.code = code;
  if (draft.notes !== stored.notes && notes !== (glaze.notes ?? null)) change.notes = notes;
  return Object.keys(change).length ? change : null;
}

/** The label of a changed field in the change log. */
export function editFieldLabel(field: GlazeEdit['field']): MessageKey {
  return field === 'NAME' ? 'glaze.history.name' : field === 'CODE' ? 'glaze.history.code' : 'glaze.history.notes';
}

/** How a change reads: set (no old value, only notes), cleared (no new value) or changed from one value to another. */
export function editChange(edit: Pick<GlazeEdit, 'oldValue' | 'newValue'>): { key: MessageKey; values: Record<string, string> } {
  if (edit.oldValue === null) return { key: 'glaze.history.set', values: { to: edit.newValue ?? '' } };
  if (edit.newValue === null) return { key: 'glaze.history.cleared', values: { from: edit.oldValue } };
  return { key: 'glaze.history.change', values: { from: edit.oldValue, to: edit.newValue } };
}

/** A date and time of the change log, in the reader's language and time zone. */
export function formatEditedAt(instant: string, locale: string): string {
  const time = new Date(instant);
  if (Number.isNaN(time.getTime())) return instant;
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : locale, { dateStyle: 'medium', timeStyle: 'short' }).format(time);
}

/** A day of the glaze page's "added" and "last edited" lines, in the reader's language and time zone. */
export function formatEditedOn(instant: string, locale: string): string {
  const time = new Date(instant);
  if (!instant || Number.isNaN(time.getTime())) return '';
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : locale, { dateStyle: 'medium' }).format(time);
}
