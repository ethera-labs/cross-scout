// Byte/hex helpers. Postgres `bytea` columns come back from Bun.sql as
// Uint8Array; the api surfaces them as `0x`-prefixed hex. Query parameters go
// the other way.

export function toHex(bytes: Uint8Array | null | undefined): string | null {
  if (bytes == null) return null;
  let out = '0x';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/** `0x`-prefixed (or bare) hex → Buffer for a `bytea` bind. */
export function fromHex(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  return Uint8Array.from(Buffer.from(clean, 'hex'));
}

export function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

export function toIsoOrNull(v: unknown): string | null {
  if (v == null) return null;
  return toIso(v);
}

/** int8/numeric may arrive as number | bigint | string; normalize to number. */
export function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  return Number(v);
}
