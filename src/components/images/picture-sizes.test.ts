import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { setLocale } from '../../lib/i18n';
import { glaze, imageInfo, stockItem } from '../../test/fixtures';
import GlazeRow from '../glazes/GlazeRow.svelte';
import ShelfRow from '../stock/ShelfRow.svelte';
import PictureCarousel from './PictureCarousel.svelte';
import PictureCover from './PictureCover.svelte';
import PictureThumbnails from './PictureThumbnails.svelte';

vi.mock('./ImageView.svelte', async () => ({ default: (await import('../../test/ImageViewStub.svelte')).default }));

/** The picture URLs a server-rendered component asks `ImageView` for, in document order. */
const sources = (body: string) => [...body.matchAll(/data-src="([^"]+)"/g)].map((match) => match[1]);
const picture = { image: imageInfo({ id: 'i1' }) };
const noop = async () => true;

beforeAll(() => setLocale('en'));

describe('picture sizes', () => {
  it('loads the card copy in covers, thumbnails, shelf and glaze rows', () => {
    expect(sources(render(PictureCover, { props: { picture, title: 'Blue', userId: 'u1' } }).body)).toEqual(['/api/images/i1/card']);
    const thumbnails = render(PictureThumbnails, { props: { pictures: [picture, { image: imageInfo({ id: 'i2' }) }], title: 'Blue', userId: 'u1' } });
    expect(sources(thumbnails.body)).toEqual(['/api/images/i1/card', '/api/images/i2/card']);
    const shelf = render(ShelfRow, {
      props: { item: stockItem(), title: 'Blue', href: '#/', picture, userId: 'u1', online: true, onSave: noop, onRemove: noop },
    });
    expect(sources(shelf.body)).toEqual(['/api/images/i1/card']);
    const row = render(GlazeRow, {
      props: {
        glaze: glaze(),
        picture,
        usedIn: 0,
        onShelf: false,
        user: null,
        online: true,
        favorite: false,
        onToggleFavorite: noop,
        href: '#/',
        combinationsHref: '#/',
      },
    });
    expect(sources(row.body)).toEqual(['/api/images/i1/card']);
  });

  it('loads the full size only in the detail gallery', () => {
    const gallery = render(PictureCarousel, { props: { pictures: { cover: picture, thumbnails: [] }, title: 'Blue', userId: 'u1' } });
    expect(sources(gallery.body)).toContain('/api/images/i1');
    expect(sources(gallery.body)).not.toContain('/api/images/i1/card');
  });

  it('shows the whole photo on a stage shaped by the tallest photo, and crops covers', () => {
    const portrait = { image: imageInfo({ id: 'p1', width: 600, height: 900 }) };
    const wide = { image: imageInfo({ id: 'w1', width: 1200, height: 900 }) };
    const gallery = render(PictureCarousel, { props: { pictures: { cover: wide, thumbnails: [portrait] }, title: 'Blue', userId: 'u1' } }).body;
    expect(gallery.match(/picture-cover--portrait/g)).toHaveLength(2);
    expect(gallery).not.toContain('picture-cover--landscape');
    expect(gallery).not.toMatch(/style=/);
    expect(render(PictureCover, { props: { picture: portrait, title: 'Blue', userId: 'u1' } }).body).not.toContain('picture-cover--stage');
  });
});
