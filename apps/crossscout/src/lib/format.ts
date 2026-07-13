import { formatUnits } from 'viem';
import type { TxFee, XtStatus } from '@cross-scout/sdk';
import { STAGE_NAMES, STAGE_ROLLED_BACK } from '@cross-scout/sdk';

/**
 * Chain display names. Public L1/testnet names are built in; rollup names
 * come from the deployment via `VITE_CHAIN_NAMES` (comma-separated
 * `<chain_id>=<name>` pairs).
 */
const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum',
  11155111: 'Sepolia',
  560048: 'Hoodi',
};

for (const pair of String(import.meta.env.VITE_CHAIN_NAMES ?? '').split(',')) {
  const [id, name] = pair.split('=');
  if (id && name && Number.isFinite(Number(id))) CHAIN_NAMES[Number(id)] = name.trim();
}

export function chainName(id: number | null | undefined): string {
  if (id == null) return '-';
  return CHAIN_NAMES[id] ?? `chain ${id}`;
}

export function shortHex(hex: string | null | undefined, lead = 6, tail = 4): string {
  if (!hex) return '-';
  if (hex.length <= lead + tail + 2) return hex;
  return `${hex.slice(0, lead + 2)}…${hex.slice(-tail)}`;
}

export function stageName(stage: number): string {
  if (stage === STAGE_ROLLED_BACK) return 'rolled back';
  return STAGE_NAMES[stage] ?? 'unknown';
}

export function statusColor(status: XtStatus): { fg: string; bg: string } {
  switch (status) {
    case 'finalized':
      return { fg: 'var(--ok)', bg: 'var(--ok-soft)' };
    case 'validated':
      return { fg: 'var(--info)', bg: 'var(--info-soft)' };
    case 'committed':
      return { fg: 'var(--warn)', bg: 'var(--warn-soft)' };
    case 'failed':
      return { fg: 'var(--bad)', bg: 'var(--bad-soft)' };
    default:
      return { fg: 'var(--fg-dim)', bg: 'var(--bg-3)' };
  }
}

export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

const numberFormatter = new Intl.NumberFormat('en-US');
const clockFormatter = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export function fmt(n: number): string {
  return numberFormatter.format(Math.round(n));
}

export function fmtMaybe(n: number | null | undefined): string {
  return n == null ? '-' : fmt(n);
}

export function formatEthCompact(wei: string | null | undefined): string {
  return formatTokenAmount(wei, 18, 'ETH');
}

/** Wall-clock HH:MM:SS for an RFC-3339 timestamp. */
export function clock(iso: string | null | undefined): string {
  if (!iso) return '-';
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return '-';
  return clockFormatter.format(time);
}

export function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null) return 'pending';
  if (ms < 1000) return `${fmt(ms)}ms`;
  const secs = Math.floor(ms / 1000);
  const minutes = Math.floor(secs / 60);
  const rem = secs % 60;
  return minutes > 0 ? `${minutes}m ${String(rem).padStart(2, '0')}s` : `${secs}s`;
}

const compactFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 2,
});

export function compactNumber(n: number): string {
  return compactFormatter.format(n);
}

/**
 * Format a raw base-unit amount with its token decimals. Falls back to the
 * raw integer string when decimals are unknown (metadata not resolved yet).
 * Large values are compacted; smaller ones keep viem's exact decimal string
 * (trailing zeros trimmed, never exponential).
 */
export function formatTokenAmount(
  amount: string | null | undefined,
  decimals: number | null | undefined,
  symbol?: string | null,
): string {
  const suffix = symbol ? ` ${symbol}` : '';
  if (!amount) return `0${suffix}`;
  if (decimals == null) return `${amount}${suffix}`;
  const exact = formatUnits(BigInt(amount), decimals);
  const value = Number(exact);
  if (value === 0) return `0${suffix}`;
  return value >= 1000 ? `${compactNumber(value)}${suffix}` : `${exact}${suffix}`;
}

const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Decimal USD string → "$1,234.56"; tiny non-zero values collapse to "<$0.01". */
export function formatUsd(value: string | null | undefined): string | null {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n > 0 && n < 0.01) return '<$0.01';
  return usdFormatter.format(n);
}

/** Append a "($x.xx)" USD suffix to a primary amount when a price is known. */
export function withUsd(primary: string, usd: string | null | undefined): string {
  const value = formatUsd(usd);
  return value ? `${primary} (${value})` : primary;
}

/** Execution fee as ETH with a USD suffix, or "pending" when unobserved. */
export function formatFee(fee: TxFee | null | undefined): string {
  return fee ? withUsd(formatEthCompact(fee.feeWei), fee.feeUsd) : 'pending';
}

/** Sum decimal wei strings, skipping malformed values from partial rows. */
export function sumWei(values: Array<string | null | undefined>): string {
  let total = 0n;
  for (const value of values) {
    if (!value) continue;
    try {
      total += BigInt(value);
    } catch {
      continue;
    }
  }
  return total.toString();
}
