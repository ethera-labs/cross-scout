import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { SuperblockStatus } from '@cross-scout/sdk';
import { api } from '../lib/api';
import type { SuperblockFilter } from '../lib/status';

const PAGE_SIZE = 50;

const EMPTY_COUNTS: Record<SuperblockStatus, number> = {
  proposed: 0,
  validated: 0,
  finalized: 0,
};

export function useSuperblocks(listActive: boolean, filter: SuperblockFilter) {
  const [cursorHistory, setCursorHistory] = useState<Array<number | undefined>>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const cursor = cursorHistory[pageIndex];

  const page = useQuery({
    queryKey: ['superblocks', filter, cursor ?? null],
    queryFn: () =>
      api.listSuperblocks({
        limit: PAGE_SIZE,
        cursor,
        status: filter === 'all' ? undefined : filter,
      }),
    enabled: listActive,
    placeholderData: keepPreviousData,
  });

  const showOlder = () => {
    const nextCursor = page.data?.nextCursor;
    if (nextCursor == null) return;
    setCursorHistory((current) => {
      const next = current.slice(0, pageIndex + 1);
      next[pageIndex + 1] = nextCursor;
      return next;
    });
    setPageIndex((current) => current + 1);
  };

  const showNewer = () => setPageIndex((current) => Math.max(0, current - 1));

  const resetPagination = () => {
    setCursorHistory([undefined]);
    setPageIndex(0);
  };

  return {
    items: page.data?.items ?? [],
    page: pageIndex + 1,
    total: page.data?.total ?? 0,
    counts: page.data?.counts ?? EMPTY_COUNTS,
    loading: page.isPending || page.isPlaceholderData,
    error: page.error instanceof Error ? page.error.message : null,
    hasNewer: pageIndex > 0,
    hasOlder: page.data?.nextCursor != null,
    showNewer,
    showOlder,
    resetPagination,
  };
}
