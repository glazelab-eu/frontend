import type { Combination } from '../api/models';
import type { translate } from '../i18n';
import type { MessageKey } from '../i18n/messages';

/**
 * The final firing of a combination: the firing that produced its result and the only structured
 * firing data (earlier or extra firings are custom steps with a label and details). Every field is
 * optional; the API checks the same limits (`model/FinalFiring`).
 */
type FiringFields = Pick<Combination, 'cone' | 'temperatureC' | 'atmosphere' | 'clayBody' | 'kiln' | 'firedOn'>;
export type Atmosphere = NonNullable<Combination['atmosphere']>;

export const atmospheres: readonly Atmosphere[] = ['OXIDATION', 'REDUCTION', 'OTHER'];
/** An Orton cone as potters write it: an optional leading 0 (022 to 01), then 1 or 2 digits. */
export const CONE_PATTERN = '0?[1-9][0-9]?';
export const MIN_TEMPERATURE_C = 100;
export const MAX_TEMPERATURE_C = 1600;
export const CLAY_BODY_LENGTH = 120;
export const KILN_LENGTH = 80;

const coneExpression = new RegExp(`^${CONE_PATTERN}$`);

/** Whether the text (trimmed) is a cone the API accepts. */
export function isCone(text: string): boolean {
  return coneExpression.test(text.trim());
}

/** Cones in firing order: 022 … 01 (the leading 0 marks the cooler range), then 1, 2, … 14. */
export function compareCones(a: string, b: string): number {
  const heat = (cone: string) => (cone.startsWith('0') ? -Number(cone) : Number(cone));
  return heat(a) - heat(b);
}

/** The Studio section's fields as typed (a number field gives null while empty). */
export interface FiringDraft {
  cone: string;
  temperatureC: number | null;
  atmosphere: Atmosphere | '';
  clayBody: string;
  kiln: string;
  firedOn: string;
}

/** The section's fields from a combination (an edit or a variation's source), or empty. */
export function firingDraft(source?: Partial<FiringFields>): FiringDraft {
  return {
    cone: source?.cone ?? '',
    temperatureC: source?.temperatureC ?? null,
    atmosphere: source?.atmosphere ?? '',
    clayBody: source?.clayBody ?? '',
    kiln: source?.kiln ?? '',
    firedOn: source?.firedOn ?? '',
  };
}

const text = (value: string) => value.trim() || null;

/** The request fields: trimmed, blank as explicit null (the API keeps a field left out, null clears it). */
export function firingInput(draft: FiringDraft): FiringFields {
  const temperature = draft.temperatureC;
  return {
    cone: text(draft.cone),
    temperatureC: typeof temperature === 'number' && Number.isFinite(temperature) ? temperature : null,
    atmosphere: draft.atmosphere || null,
    clayBody: text(draft.clayBody),
    kiln: text(draft.kiln),
    firedOn: draft.firedOn || null,
  };
}

/** Anything filled in, so leaving the form should ask and the section starts open. */
export function firingStarted(draft: FiringDraft): boolean {
  return Object.values(firingInput(draft)).some((value) => value !== null);
}

/**
 * Whether the folded phone section is open: once any field is invalid it opens and stays open
 * until the user folds it (never over an invalid field, also when the window narrows after typing).
 */
export function firingSectionOpen(open: boolean, invalid: boolean): boolean {
  return open || invalid;
}

const atmosphereShort: Record<Atmosphere, MessageKey> = {
  OXIDATION: 'firing.atmosphere.short.OXIDATION',
  REDUCTION: 'firing.atmosphere.short.REDUCTION',
  OTHER: 'firing.atmosphere.short.OTHER',
};
const atmosphereNames: Record<Atmosphere, MessageKey> = {
  OXIDATION: 'firing.atmosphere.OXIDATION',
  REDUCTION: 'firing.atmosphere.REDUCTION',
  OTHER: 'firing.atmosphere.OTHER',
};

/** The translation key of an atmosphere's full name. */
export function atmosphereName(atmosphere: Atmosphere): MessageKey {
  return atmosphereNames[atmosphere];
}

/**
 * A card's firing line, such as "Cone 6 · Ox · Speckled stoneware": the cone (else the
 * temperature), the short atmosphere and the clay body, each only when recorded; empty when none
 * is. Kiln and date stay on the combination page.
 */
export function firingLine(fields: Partial<FiringFields>, t: typeof translate): string {
  const parts: string[] = [];
  if (fields.cone) parts.push(t('firing.line.cone', { values: { cone: fields.cone } }));
  else if (fields.temperatureC != null) parts.push(t('firing.line.temperature', { values: { temperature: fields.temperatureC } }));
  if (fields.atmosphere) parts.push(t(atmosphereShort[fields.atmosphere]));
  if (fields.clayBody) parts.push(fields.clayBody);
  return parts.join(' · ');
}

/** Whether any field of the final firing is recorded. */
export function hasFiring(fields: Partial<FiringFields>): boolean {
  return [fields.cone, fields.temperatureC, fields.atmosphere, fields.clayBody, fields.kiln, fields.firedOn].some((value) => value != null && value !== '');
}

/**
 * Distinct clay bodies of the listed combinations (the viewer's own drafts included: they may
 * see them), most used first, then alphabetically; the same name in another letter case counts
 * once, in its first spelling.
 */
export function clayBodySuggestions(combinations: readonly Pick<Combination, 'clayBody'>[]): string[] {
  const counts = new Map<string, { name: string; count: number }>();
  for (const { clayBody } of combinations) {
    const name = clayBody?.trim();
    if (!name) continue;
    const key = name.toLocaleLowerCase();
    const entry = counts.get(key);
    if (entry) entry.count++;
    else counts.set(key, { name, count: 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).map(({ name }) => name);
}

/** The cones of the given combinations, once each, in firing order (Explore's cone filter). */
export function conesOf(combinations: readonly Pick<Combination, 'cone'>[]): string[] {
  return [...new Set(combinations.map(({ cone }) => cone).filter((cone) => !!cone))].map((cone) => cone!).sort(compareCones);
}

/**
 * A firing date (`YYYY-MM-DD`, no time zone) in the reader's language, the same day everywhere;
 * English follows the British usage of the texts (12 Oct 2026).
 */
export function formatFiredOn(date: string, locale: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(day.getTime())) return date;
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : locale, {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(day);
}
