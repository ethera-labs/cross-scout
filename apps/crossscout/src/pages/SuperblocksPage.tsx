import { useMemo } from 'react';
import type { Superblock } from '@cross-scout/sdk';
import { FilterBar } from '../components/primitives';
import { SuperblockRow } from '../components/rows';
import type { ChainView } from '../lib/chains';
import type { SuperblockFilter } from '../lib/status';
import { superblockFilters, superblockLabels } from '../lib/status';

export function SuperblocksPage({
  superblocks,
  chains,
  filter,
  setFilter,
  onSuperblock,
}: {
  superblocks: Superblock[];
  chains: Map<number, ChainView>;
  filter: SuperblockFilter;
  setFilter: (filter: SuperblockFilter) => void;
  onSuperblock: (sb: Superblock) => void;
}) {
  const counts = useMemo(() => {
    const base: Record<SuperblockFilter, number> = {
      all: superblocks.length,
      proposed: 0,
      validated: 0,
      finalized: 0,
    };
    superblocks.forEach((sb) => {
      base[sb.status] += 1;
    });
    return base;
  }, [superblocks]);
  const rows = filter === 'all' ? superblocks : superblocks.filter((sb) => sb.status === filter);

  return (
    <>
      <div className="explorer-titlebar">
        <h2>Superblocks</h2>
        <span className="mono result-count">{rows.length} superblocks</span>
      </div>
      <div className="page-toolbar">
        <FilterBar
          filters={superblockFilters}
          active={filter}
          counts={counts}
          labels={superblockLabels}
          onSelect={setFilter}
        />
      </div>
      <div className="table-head sb-head dense">
        <span>Superblock</span>
        <span>Status</span>
        <span>L1 Block</span>
        <span>Chains</span>
        <span>XTs</span>
        <span>Root Claim</span>
        <span>Age</span>
      </div>
      <div className="tx-dense-list">
        {rows.map((sb) => (
          <SuperblockRow key={sb.number} sb={sb} chains={chains} onClick={() => onSuperblock(sb)} />
        ))}
      </div>
    </>
  );
}
