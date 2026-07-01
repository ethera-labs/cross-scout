import type { XtStatus } from '@cross-scout/sdk';
import { STAGE_NAMES } from '@cross-scout/sdk';

/** Well-known Ethera rollup / chain names, best-effort. */
const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum',
  10: 'Optimism',
  480: 'World',
  8453: 'Base',
  42161: 'Arbitrum',
  7777777: 'Zora',
};

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
  return STAGE_NAMES[stage] ?? 'unknown';
}

export function statusColor(status: XtStatus): { fg: string; bg: string } {
  switch (status) {
    case 'finalized':
      return { fg: 'var(--ok)', bg: 'var(--ok-soft)' };
    case 'validated':
      return { fg: 'var(--info)', bg: 'var(--info-soft)' };
    case 'unsafe':
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
