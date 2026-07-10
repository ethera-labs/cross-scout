import type { Xt } from '@cross-scout/sdk';
import { CursorPagination } from '../components/CursorPagination';
import { EmptyPanel, FilterBar } from '../components/primitives';
import { TxTableRow } from '../components/rows';
import type { ChainView } from '../lib/chains';
import { fmt } from '../lib/format';
import type { XtFilter } from '../lib/status';
import { xtFilters, xtLabels } from '../lib/status';

export function TransactionsPage({
  xts,
  chains,
  filter,
  setFilter,
  onTx,
  live,
  paused,
  setPaused,
  counts,
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
  filter: XtFilter;
  setFilter: (filter: XtFilter) => void;
  onTx: (xt: Xt) => void;
  live: boolean;
  paused: boolean;
  setPaused: (paused: boolean) => void;
  counts: Record<XtFilter, number>;
  total: number;
  page: number;
  loading: boolean;
  hasNewer: boolean;
  hasOlder: boolean;
  onNewer: () => void;
  onOlder: () => void;
}) {
  const label = paused ? 'PAUSED' : live ? 'LIVE' : 'POLLING';
  const title = paused
    ? 'updates paused - click to resume'
    : live
      ? 'streaming - click to pause'
      : 'stream reconnecting, polling every 15s - click to pause';

  return (
    <>
      <div className="transactions-titlebar">
        <h2>Transactions</h2>
        <button
          type="button"
          className={paused ? 'live-mode off mono' : 'live-mode mono'}
          onClick={() => setPaused(!paused)}
          title={title}
        >
          <i />
          {label}
          <b />
        </button>
      </div>
      <div className="page-toolbar">
        <div className="tx-toolbar-left">
          <FilterBar filters={xtFilters} active={filter} counts={counts} labels={xtLabels} onSelect={setFilter} />
        </div>
        <span className="mono result-count">{xts.length} shown of {fmt(total)} matching</span>
      </div>
      <div className="table-head tx-head dense">
        <span>Time</span>
        <span>Source Tx Hash</span>
        <span>From</span>
        <span />
        <span>To</span>
        <span>Protocol</span>
        <span>Status</span>
      </div>
      <div className="tx-dense-list">
        {loading ? (
          <EmptyPanel>loading transactions...</EmptyPanel>
        ) : xts.length ? (
          xts.map((xt) => <TxTableRow key={xt.xtHash} xt={xt} chains={chains} onClick={() => onTx(xt)} />)
        ) : (
          <EmptyPanel>no transactions on this page</EmptyPanel>
        )}
      </div>
      <CursorPagination
        ariaLabel="Transaction pages"
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
