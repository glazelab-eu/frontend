import { afterEach, describe, expect, it, vi } from 'vitest';
import { pictureFocusFallback } from './picture-focus';

describe('pictureFocusFallback', () => {
  afterEach(() => vi.unstubAllGlobals());

  function focusedIn(card: { isConnected: boolean; focus: () => void } | null) {
    vi.stubGlobal('document', {
      activeElement: {
        closest: (selector: string) => (selector === '[data-picture-focus]' ? card : null),
      },
    });
  }

  it('focuses the card that held the focus when the dialog opened', () => {
    const card = { isConnected: true, focus: vi.fn() };
    focusedIn(card);
    const fallback = pictureFocusFallback();
    focusedIn(null);
    expect(fallback()).toBe(true);
    expect(card.focus).toHaveBeenCalledOnce();
  });

  it('answers false when the card left as well or there was none', () => {
    const card = { isConnected: false, focus: vi.fn() };
    focusedIn(card);
    expect(pictureFocusFallback()()).toBe(false);
    expect(card.focus).not.toHaveBeenCalled();
    focusedIn(null);
    expect(pictureFocusFallback()()).toBe(false);
  });
});
