import { useState } from 'react';
import type { MailboxView, NetworkStats, Superblock, Xt } from '@cross-scout/sdk';
import type { FlowMode } from '../components/FlowChart';
import { FlowChart } from '../components/FlowChart';
import { EmptyPanel, GhostButton, SectionTitle } from '../components/primitives';
import { SuperblockRow, TxRow } from '../components/rows';
import { StatGrid } from '../components/StatGrid';
import type { ChainView } from '../lib/chains';
import { downloadXtsCsv } from '../lib/csv';
import { chainName } from '../lib/format';
import type { Network } from '../lib/nav';
import { Button } from '../ui/Button';

export function OverviewPage({
  stats,
  xts,
  superblocks,
  mailbox,
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
  mailbox: MailboxView | null;
  chains: ChainView[];
  byId: Map<number, ChainView>;
  network: Network;
  loading: boolean;
  onTxs: () => void;
  onTx: (xt: Xt) => void;
  onSuperblock: (sb: Superblock) => void;
}) {
  const [flowMode, setFlowMode] = useState<FlowMode>('volume');
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
      <StatGrid stats={stats} xts={xts} mailbox={mailbox} />

      <SectionTitle title="Cross-Chain Activity" action={<GhostButton onClick={onTxs}>View all</GhostButton>} />
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
          <button type="button" onClick={() => downloadXtsCsv(xts)} disabled={xts.length === 0}>
            Download
          </button>
        </div>
      </div>
      <FlowChart xts={xts} chains={chains} mode={flowMode} />

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
