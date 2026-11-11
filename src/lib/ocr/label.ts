import type { Glaze } from '../api/models';

export interface LabelSuggestion {
  manufacturer: string;
  name: string;
  code: string;
}
export interface LabelWord {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}
export interface LabelText {
  text: string;
  words: LabelWord[];
}
const compact = (text: string) => text.toUpperCase().replace(/[^A-Z0-9]/g, '');
const prefix = (code: string) => code.toUpperCase().match(/^[A-Z]+/)?.[0] ?? '';
const clean = (text: string) => text.trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

/** Conservative suggestions: ambiguity or unreadable name words leave a field for the user. */
export function suggestLabel({ text, words }: LabelText, glazes: Glaze[]): LabelSuggestion {
  const manufacturers = [...new Map(glazes.map((g) => [g.manufacturer.id, g.manufacturer])).values()];
  const fold = (value: string) =>
    value
      .toLowerCase()
      .normalize('NFC')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  const label = ` ${fold(text)} `;
  const explicit = manufacturers.filter((m) => [m.name, m.shortId].some((name) => label.includes(` ${fold(name)} `)));
  const brands = new Map(explicit.map((m) => [fold(m.name), m.name]));
  for (const [name, marker] of [
    ['Amaco', /\bamaco\b|\bpotter['’]?s\s+choice\b/i],
    ['Mayco', /\bmayco\b/i],
    ['BOTZ', /\bbotz\b/i],
  ] as const)
    if (marker.test(text) && !brands.has(fold(name))) brands.set(fold(name), name);
  let manufacturer = brands.size === 1 ? [...brands.values()][0] : '';
  const candidates = words.filter((word) => {
    // Unmatched punctuation often belongs to firing/volume text, rather than a printed code.
    if (!/^[A-Za-z0-9]/.test(word.text)) return false;
    const value = clean(word.text)
      .toUpperCase()
      .replace(/[‐‑–−]/g, '-');
    if (
      /^\d+$/.test(value) &&
      words.some(
        (unit) =>
          /^(?:m?l|g|kg|oz|floz|pints?|litres?|liters?|grams?)$/i.test(clean(unit.text)) &&
          Math.abs((unit.bbox.y0 + unit.bbox.y1 - word.bbox.y0 - word.bbox.y1) / 2) < word.bbox.y1 - word.bbox.y0 &&
          unit.bbox.x0 >= word.bbox.x1 - (word.bbox.y1 - word.bbox.y0) &&
          unit.bbox.x0 - word.bbox.x1 < (word.bbox.y1 - word.bbox.y0) * 2,
      )
    )
      return false;
    return (
      (!/^(?:CONE|CONES|LEAD|DIN|EN|ASTM)[.-]/.test(value) &&
        (/^[A-Z]{1,5}[.-]\d{1,5}(?:[.-][A-Z0-9]{1,5})?$/.test(value) || /^[A-Z]{2,5}\d{2,4}$/.test(value))) ||
      (/^9\d{3}$/.test(value) && manufacturer.toUpperCase() === 'BOTZ') ||
      (/^\d{3,5}$/.test(value) && !!manufacturer && glazes.some((g) => g.code === value && fold(g.manufacturer.name) === fold(manufacturer)))
    );
  });
  const codes = [
    ...new Set(
      candidates.map((w) =>
        clean(w.text)
          .toUpperCase()
          .replace(/[‐‑–−]/g, '-'),
      ),
    ),
  ];
  if (codes.length !== 1) return { manufacturer, name: '', code: '' };
  const code = codes[0];
  const known = glazes.filter((g) => compact(g.code) === compact(code) && (!manufacturer || g.manufacturer.name.toLowerCase() === manufacturer.toLowerCase()));
  if (known.length === 1) return { manufacturer: known[0].manufacturer.name, name: known[0].name, code: known[0].code };
  if (!manufacturer && prefix(code)) {
    const family = [...new Set(glazes.filter((g) => prefix(g.code) === prefix(code)).map((g) => g.manufacturer.name))];
    if (family.length === 1) manufacturer = family[0];
  }
  const box = candidates[0].bbox;
  const height = box.y1 - box.y0;
  const width = box.x1 - box.x0;
  const letters = words.filter((w) => clean(w.text).length >= 2 && /^[\p{L}][\p{L}'’ -]*$/u.test(clean(w.text)));
  const beside = letters.filter(
    (w) => w.bbox.x0 > box.x1 && w.bbox.x0 < box.x1 + width * 6 && Math.min(w.bbox.y1, box.y1) - Math.max(w.bbox.y0, box.y0) > height * 0.1,
  );
  const above = letters.filter(
    (w) => w.bbox.x0 >= box.x0 - width * 0.25 && w.bbox.x0 < box.x0 + width * 3 && w.bbox.y1 <= box.y0 + height * 0.2 && w.bbox.y1 > box.y0 - height * 3,
  );
  const contiguous: LabelWord[] = [];
  let edge = box.x1;
  for (const word of beside.sort((a, b) => a.bbox.x0 - b.bbox.x0)) {
    if (word.bbox.x0 - edge > height * 1.5) break;
    contiguous.push(word);
    edge = Math.max(edge, word.bbox.x1);
  }
  const nameWords = (contiguous.length ? contiguous : above).sort((a, b) =>
    Math.abs((a.bbox.y0 + a.bbox.y1 - b.bbox.y0 - b.bbox.y1) / 2) < height * 0.7 ? a.bbox.x0 - b.bbox.x0 : a.bbox.y0 - b.bbox.y0,
  );
  // Do not turn a partially read name into a plausible but incomplete one.
  const reliable =
    nameWords.length > 0 &&
    nameWords.length <= 6 &&
    nameWords.every(
      (w) => w.confidence >= 70 && clean(w.text).length >= 3 && !/^(?:glazes?|cone|cones|lead|free|botz|amaco|mayco|choice|liquid)$/i.test(clean(w.text)),
    );
  const name = reliable
    ? nameWords
        .map((w) => clean(w.text))
        .join(' ')
        .slice(0, 120)
    : '';
  return { manufacturer, name, code };
}
