import { describe, expect, it } from 'vitest';
import spec from '../../openapi.json';
import { MAX_CAPTION } from './images/photo-details';
import { MAX_REPORT_REASON } from './images/photo-menu';
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_FILES } from './images/upload-queue';
import { pageSize } from './paging/paging';
import { MAX_JAR_G, MAX_STOCK_G, SHELF_FILTER_FROM } from './stock/shelf';
import { maxTagsPerItem } from './tags/tags';

type Limit = { maxLength?: number; maxItems?: number; maximum?: number };
const schemas = spec.components.schemas as unknown as Record<string, { properties: Record<string, Limit> }>;

describe('client limits mirror the API', () => {
  it.each([
    ['MAX_CAPTION', MAX_CAPTION, 'ImageDetailsEdit', 'caption', 'maxLength'],
    ['MAX_REPORT_REASON', MAX_REPORT_REASON, 'ImageReportInput', 'reason', 'maxLength'],
    ['maxTagsPerItem', maxTagsPerItem, 'NewGlaze', 'tags', 'maxItems'],
    ['maxTagsPerItem', maxTagsPerItem, 'NewCombination', 'tags', 'maxItems'],
    ['MAX_JAR_G', MAX_JAR_G, 'StockInput', 'jarSizeG', 'maximum'],
    ['MAX_JAR_G', MAX_JAR_G, 'StockAddition', 'jarSizeG', 'maximum'],
    ['MAX_STOCK_G', MAX_STOCK_G, 'StockAddition', 'addG', 'maximum'],
  ] as const)('%s is the contract limit %s.%s %s', (_name, client, schema, property, limit) => {
    expect(schemas[schema].properties[property][limit]).toBe(client);
  });

  // Not in the contract: the server's image encoder limit, and limits of the client's own layout.
  it.each([
    ['MAX_UPLOAD_BYTES (the API’s ImageEncoder.MAX_BYTES)', MAX_UPLOAD_BYTES, 12_000_000],
    ['MAX_UPLOAD_FILES', MAX_UPLOAD_FILES, 10],
    ['pageSize', pageSize, 12],
    ['SHELF_FILTER_FROM', SHELF_FILTER_FROM, 10],
  ])('%s stays %j', (_name, value, expected) => {
    expect(value).toBe(expected);
  });
});
