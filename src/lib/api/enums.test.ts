import { describe, expect, expectTypeOf, it } from 'vitest';
import spec from '../../../openapi.json';
import { REPORT_KINDS } from '../admin/error-reports';
import { FEEDBACK_FILTERS } from '../admin/feedback';
import type { FeedbackDevice } from '../feedback/feedback';
import type { FeedbackView, ImageView } from '../generated/types.gen';
import type { UploadTarget } from './models';
import { IMAGE_KINDS } from '../images/pictures';
import { LOOK_KINDS } from '../vision/library';
import { WISHLIST_TYPES, type WishlistType } from '../clubs/wishlist';
import type { WishlistEntryView } from '../generated/types.gen';

type Property = { enum?: (string | null)[] };
const schemas = spec.components.schemas as unknown as Record<string, { properties: Record<string, Property> }>;
const values = (schema: string, property: string) => (schemas[schema].properties[property].enum ?? []).filter((value) => value !== null);

/** Hand-written lists and unions of the API's string enums (guide topic "Contract"): a new value fails here. */
describe('hand-written enum lists mirror the API', () => {
  it('REPORT_KINDS offers every error report kind', () => {
    expect([...REPORT_KINDS].sort()).toEqual(values('ReportGroupView', 'kind').sort());
    expect(values('ReportEvent', 'kind').sort()).toEqual(values('ReportGroupView', 'kind').sort());
  });

  it('the feedback filters are every feedback status plus ALL', () => {
    expect(FEEDBACK_FILTERS.filter((filter) => filter !== 'ALL').sort()).toEqual(values('FeedbackView', 'status').sort());
  });

  it('IMAGE_KINDS lists every image kind; the similar looks compare every kind but packaging', () => {
    expect([...IMAGE_KINDS].sort()).toEqual(values('ImageView', 'kind').sort());
    expect([...LOOK_KINDS, 'PACKAGING'].sort()).toEqual(values('ImageView', 'kind').sort());
  });

  it('WISHLIST_TYPES lists every club wishlist entry type', () => {
    expect([...WISHLIST_TYPES].sort()).toEqual(values('WishlistEntryView', 'type').sort());
    expect(values('NewWishlistEntry', 'type').sort()).toEqual(values('WishlistEntryView', 'type').sort());
  });

  it('hand-written unions are the generated ones (checked by the type check)', () => {
    expectTypeOf<WishlistType>().toEqualTypeOf<WishlistEntryView['type']>();
    expectTypeOf<FeedbackDevice>().toEqualTypeOf<NonNullable<FeedbackView['device']>>();
    expectTypeOf<NonNullable<UploadTarget['kind']>>().toEqualTypeOf<ImageView['kind']>();
  });
});
