import type { XtStatus } from '@cross-scout/sdk';
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

export function formatWei(wei: string | null | undefined): string {
  if (!wei) return '0';
  try {
    const eth = Number(BigInt(wei)) / 1e18;
    if (eth === 0) return '0';
    if (eth < 0.0001) return `${eth.toExponential(2)} ETH`;
    return `${eth.toFixed(4)} ETH`;
  } catch {
    return wei;
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

export function fmt(n: number): string {
  return numberFormatter.format(Math.round(n));
}

export function fmtMaybe(n: number | null | undefined): string {
  return n == null ? '-' : fmt(n);
}

export function formatEthCompact(wei: string | null | undefined): string {
  if (!wei) return '0 ETH';
  const eth = formatWei(wei);
  return eth.endsWith('ETH') ? eth : `${eth} wei`;
}

/** Wall-clock HH:MM:SS for an RFC-3339 timestamp. */
export function clock(iso: string | null | undefined): string {
  if (!iso) return '-';
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return '-';
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(time);
}

export function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null) return 'pending';
  if (ms < 1000) return `${fmt(ms)}ms`;
  const secs = Math.floor(ms / 1000);
  const minutes = Math.floor(secs / 60);
  const rem = secs % 60;
  return minutes > 0 ? `${minutes}m ${String(rem).padStart(2, '0')}s` : `${secs}s`;
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
