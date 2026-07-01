import type { NetworkStats } from '@cross-scout/sdk';
import { chainName } from '../lib/format';

function Stat({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 120,
        border: '1px solid var(--line)',
        borderRadius: 13,
        background: 'var(--bg-1)',
        padding: '14px 18px',
      }}
    >
      <div style={{ fontSize: 22, fontWeight: 700, color: color ?? 'var(--fg)' }}>{value}</div>
      <div className="mono" style={{ fontSize: 11, color: 'var(--fg-faint)', marginTop: 4 }}>
        {label}
      </div>
    </div>
  );
}

export function StatsBar({ stats }: { stats: NetworkStats | null }) {
  if (!stats) {
    return (
      <div style={{ color: 'var(--fg-faint)', fontSize: 13, padding: '8px 0' }}>loading stats…</div>
    );
  }
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      <Stat label={`host · ${chainName(stats.hostChain)}`} value={stats.totalXts} />
      <Stat label="pending" value={stats.pending} color="var(--fg-dim)" />
      <Stat label="validated" value={stats.validated} color="var(--info)" />
      <Stat label="finalized" value={stats.finalized} color="var(--ok)" />
      <Stat label="failed" value={stats.failed} color="var(--bad)" />
      <Stat label="superblocks" value={stats.superblocks} color="var(--accent)" />
    </div>
  );
}
