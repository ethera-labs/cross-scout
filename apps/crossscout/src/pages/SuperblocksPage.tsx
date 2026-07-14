import type { Superblock, SuperblockStatus } from '@cross-scout/sdk';
import { CursorPagination } from '../components/CursorPagination';
import { EmptyPanel, FilterBar } from '../components/primitives';
import { SuperblockRow } from '../components/rows';
import type { ChainView } from '../lib/chains';
import { fmt } from '../lib/format';
import type { SuperblockFilter } from '../lib/status';
import { superblockFilters, superblockLabels } from '../lib/status';

export function SuperblocksPage({
  superblocks,
  chains,
  filter,
  setFilter,
  total,
  counts,
  page,
  loading,
  hasNewer,
  hasOlder,
  onNewer,
  onOlder,
}: {
  superblocks: Superblock[];
  chains: Map<number, ChainView>;
  filter: SuperblockFilter;
  setFilter: (filter: SuperblockFilter) => void;
  total: number;
  counts: Record<SuperblockStatus, number>;
  page: number;
  loading: boolean;
  hasNewer: boolean;
  hasOlder: boolean;
  onNewer: () => void;
  onOlder: () => void;
}) {
  const filterCounts: Record<SuperblockFilter, number> = {
    all: counts.proposed + counts.validated + counts.finalized,
    ...counts,
  };
  const rows = filter === 'all' ? superblocks : superblocks.filter((sb) => sb.status === filter);

  return (
    <>
      <div className="explorer-titlebar">
        <h2>Superblocks</h2>
        <span className="mono result-count">{rows.length} shown of {fmt(total)} matching</span>
      </div>
      <div className="page-toolbar">
        <FilterBar
          filters={superblockFilters}
          active={filter}
          counts={filterCounts}
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
        {loading ? (
          <EmptyPanel>loading superblocks...</EmptyPanel>
        ) : rows.length ? (
          rows.map((sb) => <SuperblockRow key={sb.number} sb={sb} chains={chains} />)
        ) : (
          <EmptyPanel>no superblocks on this page</EmptyPanel>
        )}
      </div>
      <CursorPagination
        ariaLabel="Superblock pages"
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
