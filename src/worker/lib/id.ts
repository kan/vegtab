/** Generate a random UUID v4 */
export function generateId(): string {
  return crypto.randomUUID();
}

/** Generate a short alphanumeric share code (6-8 chars) */
export function generateShareCode(length = 6): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Ambiguous chars (0/O, 1/I) excluded
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}
