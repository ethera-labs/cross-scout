import { useCallback, useEffect, useState } from 'react';
import type { Superblock, SuperblockStatus } from '@cross-scout/sdk';
import { api } from '../lib/api';
import type { SuperblockFilter } from '../lib/status';

const PAGE_SIZE = 50;

const EMPTY_COUNTS: Record<SuperblockStatus, number> = {
  proposed: 0,
  validated: 0,
  finalized: 0,
};

export function useSuperblocks(listActive: boolean, filter: SuperblockFilter) {
  const [pageItems, setPageItems] = useState<Superblock[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState(EMPTY_COUNTS);
  const [cursorHistory, setCursorHistory] = useState<Array<number | undefined>>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const applyUpdate = useCallback((_superblock: Superblock) => {
    setRefreshVersion((current) => current + 1);
  }, []);

  return {
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
