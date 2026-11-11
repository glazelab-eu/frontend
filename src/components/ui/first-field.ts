/**
 * `ModalShell` `initialFocus` for a form dialog: the first text-like field that can take input (never a checkbox, a
 * disabled field or a `hidden` one, such as the username field a change-password form keeps for password managers).
 */
export const FIRST_FIELD =
  'input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([hidden]):not(:disabled), select:not(:disabled), textarea:not(:disabled)';
