// Query-parameter parsing and validation shared by the route handlers. Every
// helper returns `undefined` on malformed input so handlers can 400 uniformly.

import { fromHex } from './convert.ts';

export type WindowParam = '24h' | '7d' | '30d' | 'all';
export type IntervalParam = 'hour' | 'day';

const VALID_WINDOWS = new Set<WindowParam>(['24h', '7d', '30d', 'all']);

/** The Postgres interval a window spans; `null` for the unbounded window. */
export function windowInterval(w: WindowParam): string | null {
  if (w === '24h') return '24 hours';
  if (w === '7d') return '7 days';
  if (w === '30d') return '30 days';
  return null;
}

/** Strictly numeric param; `undefined` when absent or not a safe integer. */
export function intParam(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : undefined;
}

export function windowParam(value: string | undefined): WindowParam | undefined {
  if (!value) return '24h';
  return VALID_WINDOWS.has(value as WindowParam) ? (value as WindowParam) : undefined;
}

export function intervalParam(value: string | undefined, window: WindowParam): IntervalParam {
  // The unbounded window always buckets by day - hourly would generate a
  // series proportional to the chain's age.
  if (window === 'all') return 'day';
  if (value === 'hour' || value === 'day') return value;
  return window === '24h' ? 'hour' : 'day';
}

/** `0x` + `2 * bytes` hex chars → Uint8Array, or `undefined` on bad input. */
export function hexBytes(value: string | undefined, bytes: number): Uint8Array | undefined {
  if (!value) return undefined;
  if (!new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`).test(value)) return undefined;
  return fromHex(value);
}

/** `<iso>|<0x64-hex>` compound cursor; plain ISO is rejected. */
export function validCursor(value: string): boolean {
  const [ts, hash] = value.split('|');
  return (
    ts !== undefined &&
    !Number.isNaN(Date.parse(ts)) &&
    hash !== undefined &&
    /^0x[0-9a-fA-F]{64}$/.test(hash)
  );
}
