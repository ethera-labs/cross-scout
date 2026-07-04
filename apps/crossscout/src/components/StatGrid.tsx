import type { NetworkStats } from '@cross-scout/sdk';
import { fmt, formatEthCompact, sumWei } from '../lib/format';
import { CopyButton } from '../ui/CopyButton';

export function StatGrid({ stats }: { stats: NetworkStats | null }) {
  const totalVolume = sumWei((stats?.routes ?? []).map((route) => route.valueWei));
  const statsRows: Array<[string, string, string]> = [
    ['Total xTs', fmt(stats?.totalXts ?? 0), String(stats?.totalXts ?? 0)],
    ['24h xTs', fmt(stats?.window24h.xts ?? 0), String(stats?.window24h.xts ?? 0)],
    ['Total Volume', formatEthCompact(totalVolume), totalVolume],
    ['24h Volume', formatEthCompact(stats?.window24h.volumeWei), stats?.window24h.volumeWei ?? '0'],
  ];
  return (
    <div className="stats-grid">
      {statsRows.map(([label, value, raw]) => (
        <div className="stat-cell" key={label}>
          <span className="stat-label mono">{label}</span>
          <strong className="stat-value mono">
            {value}
            <CopyButton value={raw} />
          </strong>
        </div>
      ))}
    </div>
  );
}
