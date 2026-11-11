import { describe, expect, it } from 'vitest';
import { MESSAGE_MAX, eventKey, jsonBytes, scrubStack, scrubText, truncate } from './scrub';

const TOKEN = 'abcdefghijklmnopqrstuvwxyz0123456789_-ABCDEFG';

describe('scrubText', () => {
  it.each([
    ['a hash route with a token', `failed at https://glazelab.eu/#/verify/${TOKEN} now`, 'failed at https://glazelab.eu/ now'],
    ['a query string', 'GET /api/x?token=abc&y=1 failed', 'GET /api/x failed'],
    ['an email address', 'no user anna.potter+test@example.org found', 'no user [email] found'],
    ['an email with accents', 'für jürgen@bücher.example da', 'für [email] da'],
    ['a bearer token', 'Authorization failed: Bearer abc.def-123 rejected', 'Authorization failed: Bearer [redacted] rejected'],
    ['a secret pair', 'password=hunter2 and csrfToken: xyz', 'password=[redacted] and csrfToken: [redacted]'],
    ['a quoted secret', '{"session":"s3cr3t value","ok":1}', '{"session":"[redacted]","ok":1}'],
    ['a single-quoted secret', "login({ password: 'my pass', user: 1 })", "login({ password: 'my pass', user: 1 })".replace('my pass', '[redacted]')],
    ['an equals sign with a quoted secret', 'token="a b c" next', 'token="[redacted]" next'],
    ['a long token', `reset ${TOKEN}`, 'reset [token]'],
  ])('removes %s', (_, input, expected) => {
    const out = scrubText(input, MESSAGE_MAX);
    expect(out).toBe(expected);
  });

  it('keeps a UUID and ordinary text', () => {
    const id = '123e4567-e89b-42d3-a456-426614174000';
    expect(scrubText(`glaze ${id} missing`, MESSAGE_MAX)).toBe(`glaze ${id} missing`);
  });

  it('removes control characters and unpaired surrogates, keeps newlines and emoji', () => {
    expect(scrubText('a\u0000b\u0007c\nd\ud800e 😀', MESSAGE_MAX)).toBe('abc\nde 😀');
  });

  it('cuts to the limit without splitting a pair', () => {
    expect(Array.from(scrubText('😀'.repeat(50), 10))).toHaveLength(10);
    expect(truncate('abc', 5)).toBe('abc');
  });
});

describe('scrubStack', () => {
  it('drops the origin and any query', () => {
    const stack = 'Error\n    at f (https://glazelab.eu/assets/index-abc.js?v=1:10:5)';
    expect(scrubStack(stack, 'https://glazelab.eu')).toBe('Error\n    at f (/assets/index-abc.js:10:5)');
  });
});

describe('eventKey and size', () => {
  it('treats digit runs alike and kinds apart', () => {
    expect(eventKey('ERROR', 'row 12 of 40')).toBe(eventKey('ERROR', 'row 7 of 9'));
    expect(eventKey('ERROR', 'x')).not.toBe(eventKey('WARNING', 'x'));
  });
  it('measures JSON in UTF-8 bytes', () => {
    expect(jsonBytes({ a: 'é' })).toBe(JSON.stringify({ a: 'é' }).length + 1);
  });
});
