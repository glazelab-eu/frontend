/**
 * What never shows as a letter: format characters (bidi controls, zero-width spaces and joiners), other controls, marks,
 * separators and the Hangul and Braille fillers that look blank.
 */
const INVISIBLE = /^[\p{C}\p{M}\p{Z}ᅟᅠㅤﾠ⠀]$/u;

/**
 * The letter on the phone account button: the first visible character (whole code point, so an emoji stays whole) of the
 * name, upper case; empty when nothing in it is visible.
 */
export function accountInitial(name: string): string {
  return (Array.from(name.trim()).find((character) => !INVISIBLE.test(character)) ?? '').toUpperCase();
}
