import { describe, expect, it } from 'vitest';
import { toBody, TOPMOST, type LayerHost } from './portal';

/** A stand-in for an element: attributes, and removal from its host's list. */
class Layer {
  readonly attributes = new Set<string>();
  host?: FakeHost;
  constructor(readonly name: string) {}
  setAttribute(name: string) {
    this.attributes.add(name);
  }
  hasAttribute(name: string) {
    return this.attributes.has(name);
  }
  remove() {
    this.host?.list.splice(this.host.list.indexOf(this), 1);
    this.host = undefined;
  }
}

class FakeHost implements LayerHost {
  list: Layer[] = [];
  get children() {
    return this.list as unknown as ArrayLike<Element>;
  }
  insertBefore(node: Element, before: Element | null) {
    const layer = node as unknown as Layer;
    layer.remove();
    const at = before ? this.list.indexOf(before as unknown as Layer) : this.list.length;
    this.list.splice(at, 0, layer);
    layer.host = this;
  }
}

const open = (host: FakeHost, name: string, topmost = false) => {
  const layer = new Layer(name);
  return { layer, close: toBody(layer as unknown as Element, topmost, host) };
};
const names = (host: FakeHost) => host.list.map((layer) => layer.name);

describe('toBody', () => {
  it('appends layers in their opening order, so the newest is the top dialog, and its cleanup removes the layer', () => {
    const host = new FakeHost();
    open(host, 'app');
    const viewer = open(host, 'viewer');
    open(host, 'confirm');
    expect(names(host)).toEqual(['app', 'viewer', 'confirm']);
    viewer.close();
    expect(names(host)).toEqual(['app', 'confirm']);
  });

  it('keeps a topmost layer last: a dialog opened after it goes beneath it', () => {
    const host = new FakeHost();
    open(host, 'upload');
    const terms = open(host, 'terms', true);
    expect(terms.layer.hasAttribute(TOPMOST)).toBe(true);
    open(host, 'viewer');
    expect(names(host)).toEqual(['upload', 'viewer', 'terms']);
    terms.close();
    open(host, 'confirm');
    expect(names(host)).toEqual(['upload', 'viewer', 'confirm']);
  });
});
