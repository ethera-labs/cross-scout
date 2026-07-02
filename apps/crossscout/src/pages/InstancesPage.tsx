import type { Xt } from '@cross-scout/sdk';
import { ChainStack } from '../components/primitives';
import type { ChainView } from '../lib/chains';
import { formatEthCompact, shortHex, stageName, timeAgo } from '../lib/format';
import { statusVar } from '../lib/status';

export function InstancesPage({
  xts,
  chains,
  onTx,
}: {
  xts: Xt[];
  chains: Map<number, ChainView>;
  onTx: (xt: Xt) => void;
}) {
  return (
    <>
      <div className="explorer-titlebar">
        <h2>Instances</h2>
        <span className="mono result-count">{xts.length} instances in view</span>
      </div>
      <div className="table-head inst-head dense">
        <span>Instance</span>
        <span>XT Hash</span>
        <span>Chains</span>
        <span>Stage</span>
        <span>Decision</span>
        <span>Protocol</span>
        <span>Age</span>
      </div>
      <div className="tx-dense-list">
        {xts.map((xt) => (
          <button type="button" className="dense-table-row inst-table-row" key={xt.instanceId} onClick={() => onTx(xt)}>
            <span className="instance-id">
              <span style={{ background: statusVar[xt.status], boxShadow: `0 0 7px ${statusVar[xt.status]}` }} />
              <strong className="mono">{shortHex(xt.instanceId, 8, 5)}</strong>
            </span>
            <span className="tx-protocol-cell">
              <strong className="mono">{shortHex(xt.xtHash, 6, 5)}</strong>
              <small>{xt.superblockNumber ? `#${xt.superblockNumber}` : 'pending settlement'}</small>
            </span>
            <ChainStack ids={xt.chains} chains={chains} />
            <span className="tx-protocol-cell">
              <strong>{stageName(xt.stage)}</strong>
              <small className="mono">stage {xt.stage}</small>
            </span>
            <span className={xt.status === 'failed' ? 'decision abort' : 'decision commit'}>
              {xt.status === 'failed' ? 'ABORT' : 'COMMIT'}
            </span>
            <span className="tx-protocol-cell">
              <strong>{xt.chains.length > 2 ? 'Multi-hop XT' : 'Mailbox XT'}</strong>
              <small>{formatEthCompact(xt.valueWei)}</small>
            </span>
            <span className="mono tx-time right">{timeAgo(xt.updatedAt)}</span>
          </button>
        ))}
      </div>
    </>
  );
}
