import { describe, expect, it } from 'vitest';
import {
  MAX_REPORT_SEARCH,
  NO_REPORT_FILTER,
  OCCURRENCE_PAGE_SIZE,
  deviceFacts,
  deviceName,
  excerpt,
  filterQuery,
  isFiltered,
  kindKey,
  nextOccurrencePage,
  timezoneText,
  viewportRange,
  withoutGroup,
  withoutOccurrence,
} from './error-reports';

describe('filterQuery', () => {
  it('sends only what is set and strips the search text', () => {
    expect(filterQuery(NO_REPORT_FILTER)).toEqual({});
    expect(filterQuery({ kind: 'WARNING', build: '0.1.0 (a)', q: '  boom  ' })).toEqual({ kind: 'WARNING', build: '0.1.0 (a)', q: 'boom' });
    expect(filterQuery({ kind: '', build: '', q: '   ' })).toEqual({});
  });
  it('cuts the search at the longest text the API accepts', () => {
    expect(filterQuery({ kind: '', build: '', q: 'x'.repeat(300) }).q).toHaveLength(MAX_REPORT_SEARCH);
  });
  it('says whether a filter narrows the list', () => {
    expect(isFiltered(NO_REPORT_FILTER)).toBe(false);
    expect(isFiltered({ kind: 'ERROR', build: '', q: '' })).toBe(true);
    expect(isFiltered({ kind: '', build: '', q: ' ' })).toBe(false);
  });
});

describe('lists', () => {
  it('asks for the page after the rows shown, because deletions shift the server pages', () => {
    expect(nextOccurrencePage(0)).toBe(0);
    expect(nextOccurrencePage(OCCURRENCE_PAGE_SIZE)).toBe(1);
    expect(nextOccurrencePage(OCCURRENCE_PAGE_SIZE * 2 - 1)).toBe(1);
  });
  it('drops only the deleted group or report', () => {
    expect(withoutGroup([{ fingerprint: 'a' }, { fingerprint: 'b' }], 'a')).toEqual([{ fingerprint: 'b' }]);
    expect(withoutOccurrence([{ id: '1' }, { id: '2' }], '2')).toEqual([{ id: '1' }]);
  });
  it('names every kind', () => {
    expect(kindKey('ERROR')).toBe('errorReports.kind.error');
    expect(kindKey('WARNING')).toBe('errorReports.kind.warning');
    expect(kindKey('UNHANDLED_REJECTION')).toBe('errorReports.kind.rejection');
  });
});

describe('group spread', () => {
  it('gives the viewport range only when both ends are known', () => {
    expect(viewportRange({ minViewportWidth: 320, maxViewportWidth: 1280 })).toEqual({ min: 320, max: 1280 });
    expect(viewportRange({ minViewportWidth: null, maxViewportWidth: null })).toBeNull();
  });
  it('keeps unknown browsers and systems null', () => {
    expect(deviceName({ browser: ' Chrome ', os: null })).toEqual({ browser: 'Chrome', os: null });
    expect(deviceName({ browser: '', os: 'Android' })).toEqual({ browser: null, os: 'Android' });
  });
});

describe('excerpt', () => {
  it('collapses whitespace and shortens long messages', () => {
    expect(excerpt('a\n  b')).toBe('a b');
    expect(excerpt('x'.repeat(100))).toHaveLength(60);
    expect(excerpt('x'.repeat(100)).endsWith('…')).toBe(true);
  });
});

describe('timezoneText', () => {
  it('turns the minutes behind UTC into the usual offset', () => {
    expect(timezoneText(-60)).toBe('UTC+1');
    expect(timezoneText(0)).toBe('UTC+0');
    expect(timezoneText(300)).toBe('UTC-5');
    expect(timezoneText(-330)).toBe('UTC+5:30');
  });
});

describe('deviceFacts', () => {
  it('lists only the facts the browser told', () => {
    expect(deviceFacts({})).toEqual([]);
    const facts = deviceFacts({
      browser: 'Chrome',
      browserVersion: '142.0',
      os: 'Android',
      screenWidth: 412,
      screenHeight: 915,
      viewportWidth: 412,
      pointer: 'COARSE',
      standalone: true,
      online: false,
      serviceWorker: 'ACTIVE',
      colorScheme: 'DARK',
      timezoneOffsetMinutes: -60,
      deviceMemoryGb: 8,
    });
    expect(facts).toEqual([
      { label: 'errorReports.device.browser', text: 'Chrome 142.0' },
      { label: 'errorReports.device.os', text: 'Android' },
      { label: 'errorReports.device.screen', text: '412 × 915' },
      { label: 'errorReports.device.pointer', key: 'errorReports.pointer.coarse' },
      { label: 'errorReports.device.installed', key: 'errorReports.yes' },
      { label: 'errorReports.device.online', key: 'errorReports.no' },
      { label: 'errorReports.device.serviceWorker', key: 'errorReports.worker.active' },
      { label: 'errorReports.device.colorScheme', key: 'errorReports.scheme.dark' },
      { label: 'errorReports.device.timezone', text: 'UTC+1' },
      { label: 'errorReports.device.memory', text: '8 GB' },
    ]);
  });
});
