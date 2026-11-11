/** What `toBody` needs of `<body>`: the layers already moved there and a way to insert one. */
export interface LayerHost {
  readonly children: ArrayLike<Element>;
  insertBefore(node: Element, before: Element | null): unknown;
}

/** Marks a layer that stays above every layer opened after it (the blocking terms dialog). */
export const TOPMOST = 'data-layer-topmost';

/**
 * Moves a full-screen layer (a dialog's backdrop) to the end of `<body>`, out of every stacking context and containing block of the page
 * (a sticky gallery column, a header), so its `--z-modal` counts against the whole page. Layers keep their opening order, which makes the
 * newest the top dialog (`topDialog`), except that a topmost layer stays last. Returns the cleanup that removes the layer.
 */
export function toBody(layer: Element, topmost = false, host: LayerHost = document.body): () => void {
  if (topmost) layer.setAttribute(TOPMOST, '');
  const first = topmost ? null : (Array.from(host.children).find((child) => child !== layer && child.hasAttribute(TOPMOST)) ?? null);
  host.insertBefore(layer, first);
  return () => layer.remove();
}
