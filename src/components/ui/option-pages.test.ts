import { describe, expect, it } from 'vitest';
import { activeOption, nearListEnd, nearListStart, OPTION_PAGE, openWindow, optionWindow } from './option-pages';

describe('openWindow', () => {
  it('opens on the first page while the active option is within it, and on all of a short list', () => {
    expect(openWindow(-1, 4000)).toEqual({ start: 0, end: OPTION_PAGE });
    expect(openWindow(0, 4000)).toEqual({ start: 0, end: OPTION_PAGE });
    expect(openWindow(OPTION_PAGE - 1, 4000)).toEqual({ start: 0, end: OPTION_PAGE });
    expect(openWindow(-1, 12)).toEqual({ start: 0, end: 12 });
    expect(openWindow(-1, 0)).toEqual({ start: 0, end: 0 });
  });

  it('opens on one page around an active option further down, never everything before it (PICK-1)', () => {
    expect(openWindow(2999, 4050)).toEqual({ start: 2999 - OPTION_PAGE / 2, end: 2999 + OPTION_PAGE / 2 });
    expect(openWindow(OPTION_PAGE, 4000)).toEqual({ start: OPTION_PAGE / 2, end: OPTION_PAGE + OPTION_PAGE / 2 });
    // Near the end the page ends with the last match.
    expect(openWindow(4049, 4050)).toEqual({ start: 4050 - OPTION_PAGE, end: 4050 });
    expect(openWindow(59, 60)).toEqual({ start: 10, end: 60 });
  });
});

describe('optionWindow when the matches arrive after the list opened', () => {
  it('fills an empty or short window up to a page: a picker whose options follow the text (tag suggestions) opened with none', () => {
    expect(optionWindow({ start: 0, end: 0 }, -1, 1)).toEqual({ start: 0, end: 1 });
    expect(optionWindow({ start: 0, end: 3 }, 0, 4000)).toEqual({ start: 0, end: OPTION_PAGE });
    expect(optionWindow({ start: 100, end: 120 }, 110, 4000)).toEqual({ start: 100, end: 100 + OPTION_PAGE });
    // A window grown by scrolling keeps its size.
    expect(optionWindow({ start: 0, end: 3 * OPTION_PAGE }, 0, 4000)).toEqual({ start: 0, end: 3 * OPTION_PAGE });
  });
});

describe('optionWindow', () => {
  it('keeps a window that holds the active option', () => {
    expect(optionWindow({ start: 10, end: 60 }, 59, 60)).toEqual({ start: 10, end: 60 });
    expect(optionWindow({ start: 0, end: 3 * OPTION_PAGE }, 4, 4000)).toEqual({ start: 0, end: 3 * OPTION_PAGE });
    expect(optionWindow({ start: 0, end: OPTION_PAGE }, -1, 4000)).toEqual({ start: 0, end: OPTION_PAGE });
  });

  it('grows to an active option the keyboard moved past either edge', () => {
    expect(optionWindow({ start: 0, end: OPTION_PAGE }, OPTION_PAGE, 4000)).toEqual({ start: 0, end: OPTION_PAGE + 1 });
    expect(optionWindow({ start: 10, end: 60 }, 9, 60)).toEqual({ start: 9, end: 60 });
  });

  it('never reaches past the matches when they shrink under an open list', () => {
    expect(optionWindow({ start: 0, end: OPTION_PAGE }, 4, 5)).toEqual({ start: 0, end: 5 });
    expect(optionWindow({ start: 3000, end: 3050 }, 1, 2)).toEqual({ start: 1, end: 2 });
    expect(optionWindow({ start: 3000, end: 3050 }, -1, 0)).toEqual({ start: 0, end: 0 });
  });
});

describe('nearListEnd', () => {
  it('is true within one view of the end and false further up', () => {
    // A 256 px list over 2000 px of options.
    expect(nearListEnd(0, 256, 2000)).toBe(false);
    expect(nearListEnd(1487, 256, 2000)).toBe(false);
    expect(nearListEnd(1488, 256, 2000)).toBe(true);
    expect(nearListEnd(1744, 256, 2000)).toBe(true);
  });
});

describe('nearListStart', () => {
  it('is true within one view of the start and false further down', () => {
    expect(nearListStart(0, 256)).toBe(true);
    expect(nearListStart(256, 256)).toBe(true);
    expect(nearListStart(257, 256)).toBe(false);
  });
});

describe('activeOption', () => {
  it('keeps an active option that is still among the matches, and none when there was none', () => {
    expect(activeOption(0, 12)).toBe(0);
    expect(activeOption(11, 12)).toBe(11);
    expect(activeOption(-1, 12)).toBe(-1);
  });

  it('moves to the last match when the matches shrink under it (a sync delta, a glaze removed)', () => {
    expect(activeOption(11, 5)).toBe(4);
    expect(activeOption(5, 5)).toBe(4);
    expect(activeOption(3999, 1)).toBe(0);
  });

  it('names no option when no match is left', () => {
    expect(activeOption(3, 0)).toBe(-1);
    expect(activeOption(0, 0)).toBe(-1);
  });
});
