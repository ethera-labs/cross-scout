import { useState } from 'react';
import { formatEther } from 'viem';
import type { ActivityPoint, AssetVolume, NetworkStats, RouteVolume, Superblock, Xt } from '@cross-scout/sdk';
import { AreaChart } from '../components/AreaChart';
import type { FlowMode } from '../components/FlowChart';
import { FlowChart } from '../components/FlowChart';
import { EmptyPanel, GhostButton, SectionTitle } from '../components/primitives';
import { SuperblockRow, TxRow } from '../components/rows';
import { StatGrid } from '../components/StatGrid';
import { TopAssets } from '../components/TopAssets';
import type { AnalyticsWindow } from '../lib/api';
import type { ChainView } from '../lib/chains';
import { downloadRoutesCsv } from '../lib/csv';
import { chainName, compactNumber, fmt } from '../lib/format';
import type { Network } from '../lib/nav';
import { Button } from '../ui/Button';

const windows: AnalyticsWindow[] = ['24h', '7d', '30d', 'all'];

type ActivityMetric = 'transactions' | 'volume';

export function OverviewPage({
  stats,
  xts,
  superblocks,
  activity,
  routes,
  assets,
  window: analyticsWindow,
  setWindow,
  chains,
  byId,
  network,
  loading,
  onTxs,
  onTx,
  onSuperblock,
}: {
  stats: NetworkStats | null;
  xts: Xt[];
  superblocks: Superblock[];
  activity: ActivityPoint[];
  routes: RouteVolume[];
  assets: AssetVolume[];
  window: AnalyticsWindow;
  setWindow: (window: AnalyticsWindow) => void;
  chains: ChainView[];
  byId: Map<number, ChainView>;
  network: Network;
  loading: boolean;
  onTxs: () => void;
  onTx: (xt: Xt) => void;
  onSuperblock: (sb: Superblock) => void;
}) {
  const [flowMode, setFlowMode] = useState<FlowMode>('volume');
  const [metric, setMetric] = useState<ActivityMetric>('transactions');
  const siteUrl = import.meta.env.VITE_NETWORK_SITE_URL as string | undefined;

  return (
    <div className="overview-page">
      <div className="overview-head">
        <div className="section-title inline">
          <h2>Network Stats</h2>
        </div>
        <div className="overview-actions">
          {siteUrl && (
            <Button variant="subtle" size="sm" onClick={() => window.open(siteUrl, '_blank', 'noopener')}>
              Visit Ethera <span aria-hidden="true">-&gt;</span>
            </Button>
          )}
          <div className="live-pill mono">
            <span />
            {loading ? 'LOADING' : `LIVE - ${network} - ${stats ? chainName(stats.hostChain) : 'Indexer'}`}
          </div>
        </div>
      </div>
      <StatGrid stats={stats} />

      <SectionTitle title="Cross-Chain Transfers" action={<GhostButton onClick={onTxs}>View all</GhostButton>} />
      <div className="activity-toolbar">
        <div className="tabs">
          {(['volume', 'transfers'] as FlowMode[]).map((mode) => (
            <button
              type="button"
              key={mode}
              className={flowMode === mode ? 'tab active' : 'tab'}
              onClick={() => setFlowMode(mode)}
            >
              {mode === 'volume' ? 'Volume' : 'Transfers'}
            </button>
          ))}
        </div>
        <div className="toolbar-actions">
          <div className="tabs">
            {windows.map((item) => (
              <button
                type="button"
                key={item}
                className={analyticsWindow === item ? 'tab active' : 'tab'}
                onClick={() => setWindow(item)}
              >
                {item === 'all' ? 'All' : `Last ${item}`}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => downloadRoutesCsv(routes, analyticsWindow)} disabled={routes.length === 0}>
            Download
          </button>
        </div>
      </div>
      <FlowChart
        routes={routes}
        chains={chains}
        mode={flowMode}
        empty={
          flowMode === 'volume'
            ? 'no bridged value in the current window'
            : 'no transfers in the current window'
        }
      />

      <SectionTitle
        title="Activity"
        action={
          <div className="tabs">
            {(['transactions', 'volume'] as ActivityMetric[]).map((item) => (
              <button
                type="button"
                key={item}
                className={metric === item ? 'tab active' : 'tab'}
                onClick={() => setMetric(item)}
              >
                {item === 'transactions' ? 'Transactions' : 'Volume'}
              </button>
            ))}
          </div>
        }
      />
      <AreaChart
        points={activity.map((point) => ({
          ts: point.bucket,
          value: metric === 'transactions' ? point.count : Number(formatEther(BigInt(point.volumeWei))),
        }))}
        formatValue={(value) =>
          metric === 'transactions' ? fmt(value) : `${compactNumber(value)} ETH`
        }
        empty="no activity in the current window"
      />

      <SectionTitle title="Top Transferred Assets" />
      <TopAssets assets={assets} chains={byId} window={analyticsWindow} />

      <SectionTitle title="Latest Cross-Chain Transactions" action={<GhostButton onClick={onTxs}>View all</GhostButton>} />
      {xts.length === 0 ? (
        <EmptyPanel>waiting for cross-chain transactions...</EmptyPanel>
      ) : (
        <div className="tx-feed">
          {xts.slice(0, 7).map((xt) => (
            <TxRow key={xt.xtHash} xt={xt} chains={byId} onClick={() => onTx(xt)} />
          ))}
        </div>
      )}

      <SectionTitle title="Recent Superblocks" />
      {superblocks.length === 0 ? (
        <EmptyPanel>no superblocks yet</EmptyPanel>
      ) : (
        <div className="tx-dense-list">
          {superblocks.slice(0, 5).map((sb) => (
            <SuperblockRow key={sb.number} sb={sb} chains={byId} onClick={() => onSuperblock(sb)} />
          ))}
        </div>
      )}
    </div>
  );
}
