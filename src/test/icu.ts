// The ICU parser of `intl-messageformat`, which svelte-i18n formats with (a dependency of svelte-i18n, not of the app). Not
// svelte-i18n's `getMessageFormatter`: it memoizes by the message alone, so a call would leave a formatter in the wrong locale.
import { parse, TYPE, type MessageFormatElement } from '@formatjs/icu-messageformat-parser';

/**
 * The argument names of an ICU message, nested select and plural branches included, sorted and without repeats, parsed as
 * svelte-i18n parses it (`ignoreTag`). Throws on a syntax error such as an unbalanced brace or a plural without `other`.
 */
export function icuArguments(message: string): string[] {
  const names = new Set<string>();
  const visit = (elements: MessageFormatElement[]) => {
    for (const element of elements) {
      if (element.type === TYPE.literal || element.type === TYPE.pound) continue;
      if (element.type === TYPE.tag) {
        visit(element.children);
        continue;
      }
      names.add(element.value);
      if (element.type === TYPE.select || element.type === TYPE.plural) for (const option of Object.values(element.options)) visit(option.value);
    }
  };
  visit(parse(message, { ignoreTag: true }));
  return [...names].sort();
}
