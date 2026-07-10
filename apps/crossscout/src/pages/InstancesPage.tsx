import type { Xt } from '@cross-scout/sdk';
import { CursorPagination } from '../components/CursorPagination';
import { ChainStack, EmptyPanel } from '../components/primitives';
import type { ChainView } from '../lib/chains';
import { fmt, formatEthCompact, shortHex, stageName, timeAgo } from '../lib/format';
import { statusVar } from '../lib/status';

export function InstancesPage({
  xts,
  chains,
  onTx,
  total,
  page,
  loading,
  hasNewer,
  hasOlder,
  onNewer,
  onOlder,
}: {
  xts: Xt[];
  chains: Map<number, ChainView>;
  onTx: (xt: Xt) => void;
  total: number;
  page: number;
  loading: boolean;
  hasNewer: boolean;
  hasOlder: boolean;
  onNewer: () => void;
  onOlder: () => void;
}) {
  return (
    <>
      <div className="explorer-titlebar">
        <h2>Sessions</h2>
        <span className="mono result-count">{xts.length} shown of {fmt(total)} sessions</span>
      </div>
      <div className="table-head inst-head dense">
        <span>Session</span>
        <span>Action</span>
        <span>Chains</span>
        <span>Stage</span>
        <span>Decision</span>
        <span>Protocol</span>
        <span>Age</span>
      </div>
      <div className="tx-dense-list">
        {loading ? (
          <EmptyPanel>loading sessions...</EmptyPanel>
        ) : xts.length ? (
          xts.map((xt) => {
            const decided = xt.status !== 'pending';
            const aborted = xt.status === 'failed';
            return (
              <button
                type="button"
                className="dense-table-row inst-table-row"
                key={xt.xtHash}
                onClick={() => onTx(xt)}
              >
                <span className="instance-id">
                  <span style={{ background: statusVar[xt.status], boxShadow: `0 0 7px ${statusVar[xt.status]}` }} />
                  <strong className="mono">{shortHex(xt.xtHash, 8, 5)}</strong>
                </span>
                <span className="tx-protocol-cell">
                  <strong className="mono">{xt.label ?? 'message'}</strong>
                  <small>{xt.superblockNumber ? `#${xt.superblockNumber}` : 'pending settlement'}</small>
                </span>
                <ChainStack ids={xt.chains} chains={chains} />
                <span className="tx-protocol-cell">
                  <strong>{stageName(xt.stage)}</strong>
                  <small className="mono">stage {xt.stage}</small>
                </span>
                <span className={aborted ? 'decision abort' : decided ? 'decision commit' : 'decision'}>
                  {aborted ? 'ABORT' : decided ? 'COMMIT' : 'PENDING'}
                </span>
                <span className="tx-protocol-cell">
                  <strong>{xt.chains.length > 2 ? 'Multi-hop XT' : 'Mailbox XT'}</strong>
                  <small>{formatEthCompact(xt.valueWei)}</small>
                </span>
                <span className="mono tx-time right">{timeAgo(xt.updatedAt)}</span>
              </button>
            );
          })
        ) : (
          <EmptyPanel>no sessions on this page</EmptyPanel>
        )}
      </div>
      <CursorPagination
        ariaLabel="Session pages"
        page={page}
        loading={loading}
        hasNewer={hasNewer}
        hasOlder={hasOlder}
        onNewer={onNewer}
        onOlder={onOlder}
      />
    </>
  );
}
