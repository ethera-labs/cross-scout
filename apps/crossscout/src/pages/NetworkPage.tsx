import type { NetworkView } from '@cross-scout/sdk';
import { AreaChart } from '../components/AreaChart';
import { EmptyPanel, SectionTitle } from '../components/primitives';
import { clock, fmt, timeAgo } from '../lib/format';

export function NetworkPage({ view, loading }: { view: NetworkView | null; loading: boolean }) {
  const publisher = view?.publisher ?? null;

  return (
    <div className="overview-page">
      <SectionTitle title="Shared Publisher" />

      {publisher == null ? (
        <EmptyPanel>{loading ? 'loading network state...' : 'publisher feed not configured'}</EmptyPanel>
      ) : (
        <>
          <div className="stats-grid small" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <div className="stat-cell">
              <span className="stat-label mono">Current Period</span>
              <strong className="stat-value mono">{fmt(publisher.periodId)}</strong>
            </div>
            <div className="stat-cell">
              <span className="stat-label mono">Next Superblock</span>
              <strong className="stat-value mono">#{publisher.nextSuperblock}</strong>
            </div>
            <div className="stat-cell">
              <span className="stat-label mono">Last Finalized</span>
              <strong className="stat-value mono">#{publisher.lastFinalized}</strong>
            </div>
            <div className="stat-cell">
              <span className="stat-label mono">Queue Depth</span>
              <strong className="stat-value mono">{fmt(publisher.queued)}</strong>
            </div>
          </div>

          <div className="panel panel-spaced">
            <h3>Coordinator State</h3>
            <div className="detail-rows">
              <div>
                <span>Active 2PC</span>
                <strong className="mono">{fmt(publisher.activeXts)}</strong>
              </div>
              <div>
                <span>Active Chains</span>
                <strong className="mono">{fmt(publisher.activeChains)}</strong>
              </div>
              <div>
                <span>Connections</span>
                <strong className="mono">{fmt(publisher.connections)}</strong>
              </div>
              <div>
                <span>Registered Chains</span>
                <strong className="mono">{fmt(publisher.registeredChains)}</strong>
              </div>
              <div>
                <span>Pending Proofs</span>
                <strong className="mono">{fmt(publisher.pendingProofs)}</strong>
              </div>
              <div>
                <span>Updated</span>
                <strong className="mono">{timeAgo(publisher.ts)}</strong>
              </div>
            </div>
          </div>

          <SectionTitle title="Queue Depth - 6h" />
          <AreaChart
            points={(view?.series ?? []).map((s) => ({ ts: s.ts, value: s.queued }))}
            formatValue={fmt}
            empty="no queue depth data in the current window"
          />

          <SectionTitle title="Recent Periods" />
          {(view?.periods ?? []).length === 0 ? (
            <EmptyPanel>no periods observed yet</EmptyPanel>
          ) : (
            <>
              <div className="table-head dense" style={{ gridTemplateColumns: '1fr 1fr 1fr 1fr' }}>
                <span>Period #</span>
                <span>Superblock</span>
                <span>First Seen</span>
                <span>Last Seen</span>
              </div>
              <div className="tx-dense-list">
                {(view?.periods ?? []).map((p) => (
                  <div
                    key={p.periodId}
                    className="dense-table-row"
                    style={{ gridTemplateColumns: '1fr 1fr 1fr 1fr' }}
                  >
                    <span className="mono">{fmt(p.periodId)}</span>
                    <span className="mono">
                      {p.superblockNumber == null ? '-' : `#${p.superblockNumber}`}
                    </span>
                    <span className="tx-protocol-cell">
                      <strong className="mono">{clock(p.firstSeenAt)}</strong>
                      <small>{timeAgo(p.firstSeenAt)}</small>
                    </span>
                    <span className="mono tx-time right">{timeAgo(p.lastSeenAt)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
