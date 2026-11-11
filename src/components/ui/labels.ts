import { writable } from 'svelte/store';

/** The UI library's own fixed labels: every other visible string reaches a `ui` component as a prop. */
export interface UiLabels {
  /** The accessible name of `ModalShell`'s Close button. */
  close: string;
}

/** English, so a component renders without setup (tests); `App.svelte` sets the translated labels and follows a language switch. */
export const DEFAULT_LABELS: UiLabels = { close: 'Close' };

export const labels = writable<UiLabels>(DEFAULT_LABELS);
