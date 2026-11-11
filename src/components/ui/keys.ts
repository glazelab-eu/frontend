/**
 * Whether a key belongs to an input method's composition (its confirming Enter or its Escape): such keys are the IME's,
 * never a dialog's or a picker's. Safari reports the confirming key with `isComposing` false and key code 229.
 */
export function composing(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229;
}

/** The open dialog that takes keys: the last `[role=dialog]` in the DOM, which is also the one painted on top. */
export function topDialog(): Element | undefined {
  const dialogs = document.querySelectorAll('[role="dialog"]');
  return dialogs[dialogs.length - 1];
}
