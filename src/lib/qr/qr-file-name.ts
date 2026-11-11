// Kept apart from `qr-png` and the encoder, so a consumer names the file without loading the lazy chunk.

/**
 * The file name of a saved code: `glazelab-<kind>[-<slug of name>].png`. The slug (ASCII letters and digits, at most 40
 * characters) is left out when the name has none. Pass only names that are not secret: never the link or its token.
 */
export function qrFileName(kind: string, name?: string): string {
  const slug = (name ?? '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 40)
    .replace(/^-+|-+$/g, '');
  return `glazelab-${kind}${slug ? `-${slug}` : ''}.png`;
}
