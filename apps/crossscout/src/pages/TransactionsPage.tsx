import { useMemo } from 'react';
import type { Xt } from '@cross-scout/sdk';
import { FilterBar } from '../components/primitives';
import { TxTableRow } from '../components/rows';
import type { ChainView } from '../lib/chains';
import type { XtFilter } from '../lib/status';
import { xtFilters, xtLabels } from '../lib/status';

export function TransactionsPage({
  xts,
  chains,
  filter,
  setFilter,
  onTx,
  live,
}: {
  xts: Xt[];
  chains: Map<number, ChainView>;
  filter: XtFilter;
  setFilter: (filter: XtFilter) => void;
  onTx: (xt: Xt) => void;
  live: boolean;
}) {
  const counts = useMemo(() => {
    const base: Record<XtFilter, number> = {
      all: xts.length,
      pending: 0,
      committed: 0,
      validated: 0,
      finalized: 0,
      failed: 0,
    };
    xts.forEach((xt) => {
      base[xt.status] += 1;
    });
    return base;
  }, [xts]);
  const rows = filter === 'all' ? xts : xts.filter((xt) => xt.status === filter);

  return (
    <>
      <div className="transactions-titlebar">
        <h2>Transactions</h2>
        <span className={live ? 'live-mode mono' : 'live-mode off mono'} title={live ? 'stream connected' : 'stream disconnected - polling every 15s'}>
          <i />
          {live ? 'LIVE' : 'POLLING'}
          <b />
        </span>
      </div>
      <div className="page-toolbar">
        <div className="tx-toolbar-left">
          <FilterBar filters={xtFilters} active={filter} counts={counts} labels={xtLabels} onSelect={setFilter} />
        </div>
        <span className="mono result-count">{rows.length} results</span>
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
        {rows.map((xt) => (
          <TxTableRow key={xt.xtHash} xt={xt} chains={chains} onClick={() => onTx(xt)} />
        ))}
      </div>
    </>
  );
}
