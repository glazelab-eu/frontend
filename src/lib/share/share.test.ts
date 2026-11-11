import { describe, expect, it, vi } from 'vitest';
import { canonicalUrl, copyLink, shareLink, shareMessage } from './share';

const data = { title: 'Blue over Temmoku on glazelab', url: 'https://glazelab.eu/#/combinations/c1' };
const abort = () => new DOMException('Share canceled', 'AbortError');

describe('copyLink', () => {
  it('copies the link', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    expect(await copyLink(data.url, { clipboard: { writeText } })).toBe(true);
    expect(writeText).toHaveBeenCalledWith(data.url);
  });

  it('answers false without a clipboard or when the browser refuses', async () => {
    expect(await copyLink(data.url, {})).toBe(false);
    expect(await copyLink(data.url, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })).toBe(false);
  });
});

describe('shareLink', () => {
  it('uses the share sheet and copies nothing', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn();
    expect(await shareLink(data, { share, clipboard: { writeText } })).toBe('shared');
    expect(share).toHaveBeenCalledWith(data);
    expect(writeText).not.toHaveBeenCalled();
  });

  it('keeps the share function bound to its owner', async () => {
    const env = {
      owner: 'navigator',
      share(this: { owner: string }) {
        return this.owner === 'navigator' ? Promise.resolve() : Promise.reject(new TypeError('Illegal invocation'));
      },
    };
    expect(await shareLink(data, env as never)).toBe('shared');
  });

  it('is silent when the user closes the share sheet', async () => {
    const writeText = vi.fn();
    expect(await shareLink(data, { share: () => Promise.reject(abort()), clipboard: { writeText } })).toBe('cancelled');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('copies the link when sharing fails for another reason', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const share = () => Promise.reject(new DOMException('Not allowed', 'NotAllowedError'));
    expect(await shareLink(data, { share, clipboard: { writeText } })).toBe('copied');
    expect(writeText).toHaveBeenCalledWith(data.url);
  });

  it('copies the link when there is no share sheet', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    expect(await shareLink(data, { clipboard: { writeText } })).toBe('copied');
    expect(writeText).toHaveBeenCalledWith(data.url);
  });

  it('asks for a manual copy when the clipboard rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
    expect(await shareLink(data, { clipboard: { writeText } })).toBe('manual');
  });

  it('asks for a manual copy when the clipboard is missing or throws at once', async () => {
    expect(await shareLink(data, {})).toBe('manual');
    expect(
      await shareLink(data, {
        clipboard: {
          writeText: () => {
            throw new Error('Insecure context');
          },
        },
      }),
    ).toBe('manual');
  });

  it('asks for a manual copy when sharing fails and nothing can be copied', async () => {
    expect(await shareLink(data, { share: () => Promise.reject(new Error('Broken')) })).toBe('manual');
  });
});

describe('canonicalUrl', () => {
  const site = { origin: 'https://glazelab.eu', pathname: '/' };

  it('builds the page link from the route', () => {
    expect(canonicalUrl({ name: 'combination', id: 'c1' }, site)).toBe('https://glazelab.eu/#/combinations/c1');
    expect(canonicalUrl({ name: 'glaze', id: 'g 1' }, site)).toBe('https://glazelab.eu/#/glazes/g%201');
  });

  it('leaves out the photo pointer of an admin link', () => {
    expect(canonicalUrl({ name: 'glaze', id: 'g1', photo: 'i1' }, site)).toBe('https://glazelab.eu/#/glazes/g1');
  });

  it('keeps a base path', () => {
    expect(canonicalUrl({ name: 'glaze', id: 'g1' }, { origin: 'http://localhost:5173', pathname: '/app/' })).toBe('http://localhost:5173/app/#/glazes/g1');
  });

  it('ignores the current address: no search, list state or token route', () => {
    const location = {
      ...site,
      search: '?utm=x',
      hash: '#/login/secret-token',
      href: 'https://glazelab.eu/?utm=x#/login/secret-token',
    };
    const url = canonicalUrl({ name: 'combination', id: 'c1' }, location);
    expect(url).toBe('https://glazelab.eu/#/combinations/c1');
    expect(url).not.toMatch(/secret|utm|login/);
  });
});

describe('shareMessage', () => {
  const text = 'Hi Ada, could I borrow some Mayco SW-155 for Celadon? https://glazelab.eu/#/combinations/c1';

  it('hands the sheet the text alone, which holds its own link', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn();
    expect(await shareMessage(text, { share, clipboard: { writeText } })).toBe('shared');
    expect(share).toHaveBeenCalledWith({ text });
    expect(writeText).not.toHaveBeenCalled();
  });

  it('copies the whole text without a share sheet or when sharing fails, and is silent when the user cancels', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    expect(await shareMessage(text, { clipboard: { writeText } })).toBe('copied');
    expect(writeText).toHaveBeenCalledWith(text);
    const failing = vi.fn().mockRejectedValue(new Error('no'));
    expect(await shareMessage(text, { share: failing, clipboard: { writeText } })).toBe('copied');
    expect(await shareMessage(text, { share: vi.fn().mockRejectedValue(abort()), clipboard: { writeText: vi.fn() } })).toBe('cancelled');
  });

  it('asks for a manual copy when nothing works', async () => {
    expect(await shareMessage(text, {})).toBe('manual');
  });
});
