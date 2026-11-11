/**
 * Call when a photo dialog opens: remembers the card around the focused control
 * (`data-picture-focus`). The answer focuses that card when the dialog's opener left with the photo
 * (the last photo deleted or gone), and answers false when the card is gone too.
 */
export function pictureFocusFallback(): () => boolean {
  const card = globalThis.document?.activeElement?.closest<HTMLElement>('[data-picture-focus]');
  return () => {
    if (!card?.isConnected) return false;
    card.focus();
    return true;
  };
}
