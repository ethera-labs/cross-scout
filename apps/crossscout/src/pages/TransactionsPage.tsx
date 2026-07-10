import { useMemo, useRef, useState } from 'react';
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
  // Pausing freezes the list on its current snapshot so rows stop reordering
  // under the cursor; resuming falls back to the live feed.
  const [paused, setPaused] = useState(false);
  const frozen = useRef<Xt[]>([]);
  const toggleLive = () => {
    setPaused((current) => {
      if (!current) frozen.current = xts;
      return !current;
    });
  };
  const visible = paused ? frozen.current : xts;

  const counts = useMemo(() => {
    const base: Record<XtFilter, number> = {
      all: visible.length,
      pending: 0,
      committed: 0,
      validated: 0,
      finalized: 0,
      failed: 0,
    };
    visible.forEach((xt) => {
      base[xt.status] += 1;
    });
    return base;
  }, [visible]);
  const rows = filter === 'all' ? visible : visible.filter((xt) => xt.status === filter);

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
          onClick={toggleLive}
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
