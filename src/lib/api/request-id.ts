/**
 * A random version 4 UUID that names one write, so the API can tell a repeat of it (`requestId` of `POST /api/stock/add`),
 * or one revision of Studio's local recovery.
 * `crypto.randomUUID` exists only in secure contexts; elsewhere (a phone on the local network over plain HTTP) the same
 * format is built from `crypto.getRandomValues`.
 */
export function newRequestId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
