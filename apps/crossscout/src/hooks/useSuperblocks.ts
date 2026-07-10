import { useCallback, useEffect, useState } from 'react';
import type { Superblock, SuperblockStatus } from '@cross-scout/sdk';
import { api } from '../lib/api';
import type { SuperblockFilter } from '../lib/status';

const PAGE_SIZE = 50;
const OVERVIEW_SIZE = 5;

function upsertLatest(superblocks: Superblock[], next: Superblock): Superblock[] {
  return [next, ...superblocks.filter((item) => item.number !== next.number)]
    .sort((a, b) => b.number - a.number)
    .slice(0, OVERVIEW_SIZE);
}

const EMPTY_COUNTS: Record<SuperblockStatus, number> = {
  proposed: 0,
  validated: 0,
  finalized: 0,
};

export function useSuperblocks(listActive: boolean, filter: SuperblockFilter) {
  const [latest, setLatest] = useState<Superblock[]>([]);
  const [pageItems, setPageItems] = useState<Superblock[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState(EMPTY_COUNTS);
  const [cursorHistory, setCursorHistory] = useState<Array<number | undefined>>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void api
      .listSuperblocks({ limit: OVERVIEW_SIZE })
      .then(({ items: recent }) => {
        if (active) setLatest(recent);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const cursor = cursorHistory[pageIndex];
  useEffect(() => {
    if (!listActive) return;
    let active = true;
    setLoading(true);
    setError(null);
    setNextCursor(null);
    void api
      .listSuperblocks({
        limit: PAGE_SIZE,
        cursor,
        status: filter === 'all' ? undefined : filter,
      })
      .then((result) => {
        if (!active) return;
        setPageItems(result.items);
        setNextCursor(result.nextCursor);
        setTotal(result.total);
        setCounts(result.counts);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [cursor, filter, listActive, pageIndex, refreshVersion]);

  const showOlder = useCallback(() => {
    if (nextCursor == null) return;
    setCursorHistory((current) => {
      const next = current.slice(0, pageIndex + 1);
      next[pageIndex + 1] = nextCursor;
      return next;
    });
    setPageIndex((current) => current + 1);
  }, [nextCursor, pageIndex]);

  const showNewer = useCallback(() => {
    setPageIndex((current) => Math.max(0, current - 1));
  }, []);

  const resetPagination = useCallback(() => {
    setCursorHistory([undefined]);
    setPageIndex(0);
  }, []);

  const applyUpdate = useCallback((superblock: Superblock) => {
    setLatest((current) => upsertLatest(current, superblock));
    setRefreshVersion((current) => current + 1);
  }, []);

  return {
    latest,
    items: pageItems,
    page: pageIndex + 1,
    total,
    counts,
    loading,
    error,
    hasNewer: pageIndex > 0,
    hasOlder: nextCursor != null,
    showNewer,
    showOlder,
    resetPagination,
    applyUpdate,
  };
}
