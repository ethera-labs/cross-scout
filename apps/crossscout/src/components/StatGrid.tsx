import type { MailboxView, NetworkStats, Xt } from '@cross-scout/sdk';
import { fmt, formatEthCompact, sumWei } from '../lib/format';
import { CopyButton } from '../ui/CopyButton';

export function StatGrid({
  stats,
  xts,
  mailbox,
}: {
  stats: NetworkStats | null;
  xts: Xt[];
  mailbox: MailboxView | null;
}) {
  const routeVolume = sumWei((stats?.routes ?? []).map((route) => route.valueWei));
  const statsRows = [
    ['Total XTs', fmt(stats?.totalXts ?? xts.length)],
    ['Visible XTs', fmt(xts.length)],
    ['Mailbox Messages', fmt(mailbox?.messages.length ?? 0)],
    ['Route Volume', formatEthCompact(routeVolume)],
  ];
  return (
    <div className="stats-grid">
      {statsRows.map(([label, value]) => (
        <div className="stat-cell" key={label}>
          <span className="stat-label mono">{label}</span>
          <strong className="stat-value mono">
            {value}
            <CopyButton value={value} />
          </strong>
        </div>
      ))}
    </div>
  );
}
