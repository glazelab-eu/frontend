import { describe, expect, it } from 'vitest';
import { imageInfo } from '../../test/fixtures';
import { detailsChange, detailsDraft } from './photo-details';

describe('detailsDraft', () => {
  it('starts from the photo and shows none as empty', () => {
    expect(detailsDraft(imageInfo({ kind: 'FINISHED', caption: 'Top shelf', firedOn: '2026-10-14' }))).toEqual({
      caption: 'Top shelf',
      firedOn: '2026-10-14',
    });
    expect(detailsDraft(imageInfo())).toEqual({ caption: '', firedOn: '' });
  });
});

describe('detailsChange', () => {
  const photo = imageInfo({ kind: 'TEST_TILE', caption: 'Top shelf', firedOn: '2026-10-14' });

  it('is null when nothing differs, whitespace around the caption included', () => {
    expect(detailsChange(photo, detailsDraft(photo))).toBeNull();
    expect(detailsChange(photo, { ...detailsDraft(photo), caption: '  Top shelf ' })).toBeNull();
    expect(detailsChange(imageInfo(), { caption: '   ', firedOn: '' })).toBeNull();
  });

  it('sends only the fields that changed, never the kind (it has its own dialog)', () => {
    expect(detailsChange(photo, { ...detailsDraft(photo), caption: ' Bottom shelf ' })).toEqual({ caption: 'Bottom shelf' });
    expect(detailsChange(photo, { ...detailsDraft(photo), firedOn: '2026-11-01' })).toEqual({ firedOn: '2026-11-01' });
    expect(detailsChange(photo, { caption: 'x', firedOn: '2026-11-01' })).toEqual({
      caption: 'x',
      firedOn: '2026-11-01',
    });
  });

  it('clears a caption or a date with an explicit null', () => {
    const change = detailsChange(photo, { ...detailsDraft(photo), caption: ' ', firedOn: '' });
    expect(change).toEqual({ caption: null, firedOn: null });
    expect(Object.keys(change ?? {})).toEqual(['caption', 'firedOn']);
  });

  it('sets a first caption and date on a photo without them', () => {
    expect(detailsChange(imageInfo(), { caption: 'New', firedOn: '2026-01-01' })).toEqual({ caption: 'New', firedOn: '2026-01-01' });
  });
});
