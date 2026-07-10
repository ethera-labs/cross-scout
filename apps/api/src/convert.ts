// Scalar conversions at the Postgres row boundary, the TS counterpart of the
// store's convert.rs: `bytea` ↔ `0x`-hex, timestamptz → RFC-3339, numeric
// wideners, and int[] coercion for Bun.sql's array-like results.

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

/** `int[]` column → number[]; Bun.sql returns arrays as array-likes. */
export function numberArray(value: ArrayLike<number> | null | undefined): number[] {
  return Array.from(value ?? [], Number);
}

/** Like [`numberArray`], tolerating the `{1,2}` text form some drivers emit. */
export function pgIntArray(value: unknown): number[] {
  if (value == null) return [];
  if (typeof value === 'string') {
    const inner = value.replace(/^\{/, '').replace(/\}$/, '');
    return inner ? inner.split(',').map(Number) : [];
  }
  return Array.from(value as ArrayLike<number>, Number);
}
