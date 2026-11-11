import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { setLocale } from '../../lib/i18n';
import { imageInfo } from '../../test/fixtures';
import PictureCarousel from './PictureCarousel.svelte';
import PictureCover from './PictureCover.svelte';
import PhotoViewer from './PhotoViewer.svelte';

vi.mock('./ImageView.svelte', async () => ({ default: (await import('../../test/ImageViewStub.svelte')).default }));

const gallery = (images: Parameters<typeof imageInfo>[0][], extra: Record<string, unknown> = {}) => {
  const [cover, ...rest] = images.map((image) => ({ image: imageInfo(image) }));
  return render(PictureCarousel, { props: { pictures: { cover, thumbnails: rest }, title: 'Blue', userId: 'u1', ...extra } }).body;
};
const text = (html: string) =>
  html
    .replace(/<!--.*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');

beforeAll(() => setLocale('en'));

describe('picture carousel', () => {
  it('has one thumbnail button per photo, named with position and kind, the shown one current, and the count', () => {
    const body = gallery([
      { id: 'a', kind: 'TEST_TILE' },
      { id: 'b', kind: 'FINISHED' },
      { id: 'c', kind: 'PACKAGING' },
    ]);
    expect(body.match(/picture-strip__button(?!-)/g)).toHaveLength(3);
    expect(body).toContain('aria-label="Photo 1 of 3, Test tile"');
    expect(body).toContain('aria-label="Photo 2 of 3, Finished piece"');
    expect(body).toContain('aria-label="Photo 3 of 3, Packaging"');
    expect(body.match(/aria-current="true"/g)).toHaveLength(1);
    expect(body.match(/tabindex="0"/g)?.length).toBe(2); // the stage and the shown thumbnail only
    expect(text(body)).toContain('1 / 3');
    // The visible count repeats the live region and the thumbnails' names, so screen readers skip it.
    expect(body).toMatch(/<span class="picture-strip__count[^"]*" aria-hidden="true">\s*1 \/ 3\s*<\/span>/);
    // The thumbnails use the card copy, the stage the full size.
    expect(body.match(/data-src="\/api\/images\/a\/card"/g)).toHaveLength(1);
    expect(body.match(/data-src="\/api\/images\/a"/g)).toHaveLength(1);
  });

  it('has no thumbnail row, count or arrow buttons for one photo, and none of them has a previous or next button', () => {
    const one = gallery([{ id: 'a' }]);
    expect(one).not.toContain('picture-strip');
    expect(one).not.toContain('aria-live');
    const two = gallery([{ id: 'a' }, { id: 'b' }]);
    expect(two).not.toMatch(/Previous photo|Next photo/);
  });

  it('puts the kind, the uploader and the firing date on one line over the stage, the caption under it, and no badge on the stage', () => {
    const body = gallery([{ id: 'a', kind: 'TEST_TILE', caption: 'Two coats', firedOn: '2026-10-18', own: true }]);
    expect(text(body)).toContain('Test tile · Your photo · Fired on 18 Oct 2026');
    expect(text(body)).toContain('Two coats');
    expect(body).toMatch(/picture-carousel__line.*picture-meta__line--over.*picture-carousel__meta.*picture-meta__caption/s);
    expect(body.match(/<p class="picture-meta__line[ "]/g)).toHaveLength(1);
    // The dots only separate visually: each is hidden from screen readers and ends the part before it (after a
    // no-break space), so a wrapped line never starts with a dot; the last part has none.
    expect(body.match(/>·</g)).toHaveLength(2);
    const line = body.replace(/<!--.*?-->/g, '').match(/<p class="picture-meta__line[^"]*"[^>]*>(.*?)<\/p>/s)![1];
    const parts = line
      .split(/<span class="picture-meta__part[^"]*">/)
      .slice(1)
      .map((part) => part.trim().replace(/<\/span>$/, ''));
    expect(parts).toEqual(['Test tile\u00a0<span aria-hidden="true">·</span>', 'Your photo\u00a0<span aria-hidden="true">·</span>', 'Fired on 18 Oct 2026']);
    expect(body).not.toContain('picture-cover__badge');
    const other = gallery([{ id: 'a', kind: 'FINISHED', own: false, uploader: 'Mara' }]);
    expect(text(other)).toContain('Finished piece · Photo by Mara');
  });

  it('shows no uploader for a photo saved offline before uploaders were named, but still the deleted-account label for a null uploader', () => {
    // What the snapshot normalisation leaves of an old snapshot: no uploader at all.
    const unnamed = gallery([{ id: 'a', kind: 'FINISHED', own: false, uploader: undefined }]);
    expect(text(unnamed)).toContain('Finished piece');
    expect(text(unnamed)).not.toContain('Photo by');
    expect(text(unnamed)).not.toContain('Deleted account');
    const deleted = gallery([{ id: 'a', kind: 'FINISHED', own: false, uploader: null }]);
    expect(text(deleted)).toContain('Finished piece · Photo by Deleted account');
  });

  it('names the combination a glaze photo comes from in the same line', () => {
    const picture = { image: imageInfo({ id: 'a', kind: 'FINISHED' }), combination: { id: 'c1', title: 'Celadon over Rust', authorId: null } };
    const body = render(PictureCarousel, { props: { pictures: { cover: picture, thumbnails: [] }, title: 'Blue', userId: 'u1' } }).body;
    expect(text(body)).toContain('Finished piece · Used in Celadon over Rust · Your photo');
  });

  it('keeps the badge on list covers', () => {
    const body = render(PictureCover, { props: { picture: { image: imageInfo() }, title: 'Blue', userId: 'u1' } }).body;
    expect(body).toContain('picture-cover__badge');
    expect(text(body)).toContain('Test tile');
  });

  it('makes the stage the one focusable region that opens the viewer, for one photo as well', () => {
    const one = gallery([{ id: 'a' }]);
    expect(one).toContain('picture-carousel__viewport--openable');
    expect(one.match(/tabindex="0"/g)).toHaveLength(1);
    expect(one).toContain('aria-label="View photo full screen"');
    expect(one).not.toContain('aria-describedby');
    const three = gallery([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    expect(three).toMatch(/aria-describedby="([^"]+)"/);
    const id = /aria-describedby="([^"]+)"/.exec(three)![1];
    expect(three).toContain(`id="${id}"`);
    expect(text(three)).toContain('Press Enter to view the photo full screen.');
    // The viewer is not in the page until it is opened.
    expect(three).not.toContain('role="dialog"');
  });
});

describe('photo viewer', () => {
  const viewer = (count: number, current: number) => {
    const slides = Array.from({ length: count }, (_, position) => ({
      image: imageInfo({ id: `p${position}`, kind: position === 1 ? 'FINISHED' : 'TEST_TILE' }),
    }));
    return render(PhotoViewer, { props: { slides, current, title: 'Blue', userId: 'u1', onShow: () => {}, onClose: () => {} } }).body;
  };

  it('is a named dialog with a Close button, the full-size photo, previous and next buttons and a live position', () => {
    const body = viewer(4, 1);
    expect(body).toContain('role="dialog"');
    expect(body).toContain('aria-modal="true"');
    expect(body).toContain('aria-label="Full-screen photos of Blue"');
    expect(body).toContain('aria-label="Close"');
    expect(body).toContain('aria-label="Previous photo"');
    expect(body).toContain('aria-label="Next photo"');
    expect(body).toMatch(/aria-live="polite" aria-atomic="true">\s*Photo 2 of 4, Finished piece\s*</);
    expect(body).toMatch(/<p class="viewer__count[^"]*" aria-hidden="true">\s*2 \/ 4\s*<\/p>/);
    expect(body).not.toContain('/card"');
  });

  it('keeps the next and previous photo waiting beside the shown one, hidden from assistive technology', () => {
    const body = viewer(5, 4);
    expect(body.match(/data-src="\/api\/images\/p\d"/g)).toEqual(['data-src="/api/images/p4"', 'data-src="/api/images/p0"', 'data-src="/api/images/p3"']);
    expect(body.match(/viewer__frame--hidden/g)).toHaveLength(2);
    expect(body.match(/aria-hidden="true"[^>]*>\s*<span data-src/g)).toHaveLength(2);
    expect(body.match(/data-src="\/api\/images\/p1"/g)).toBeNull();
  });

  it('has no buttons, count or live region for one photo', () => {
    const body = viewer(1, 0);
    expect(body).not.toContain('Previous photo');
    expect(body).not.toContain('Next photo');
    expect(body).not.toContain('viewer__count');
    expect(body).not.toContain('aria-live');
    expect(body.match(/data-src=/g)).toHaveLength(1);
  });

  it('shows the same caption and meta line as the gallery', () => {
    const slides = [{ image: imageInfo({ id: 'a', caption: 'Two coats', firedOn: '2026-10-18', own: true }) }];
    const body = render(PhotoViewer, { props: { slides, current: 0, title: 'Blue', userId: 'u1', onShow: () => {}, onClose: () => {} } }).body;
    expect(text(body)).toContain('Two coats Test tile · Your photo · Fired on 18 Oct 2026');
  });
});
