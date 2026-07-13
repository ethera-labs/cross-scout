import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { Xt } from '@cross-scout/sdk';
import { api } from '../lib/api';
import type { XtFilter } from '../lib/status';

const PAGE_SIZE = 50;
const POLL_INTERVAL_MS = 15_000;

export function usePaginatedXts({
  active,
  filter,
  automaticRefresh,
  liveXts,
  polling,
}: {
  active: boolean;
  filter: XtFilter;
  automaticRefresh: boolean;
  liveXts: Xt[];
  polling: boolean;
}) {
  const [cursorHistory, setCursorHistory] = useState<Array<string | undefined>>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const cursor = cursorHistory[pageIndex];

  const page = useQuery({
    queryKey: ['xts', filter, cursor ?? null],
    queryFn: () =>
      api.listXts({
        limit: PAGE_SIZE,
        cursor,
        status: filter === 'all' ? undefined : filter,
      }),
    enabled: active,
    placeholderData: keepPreviousData,
    refetchInterval:
      active && automaticRefresh && polling && pageIndex === 0 ? POLL_INTERVAL_MS : false,
  });

  const items = useMemo(() => {
    const fetched = page.data?.items ?? [];
    if (!automaticRefresh || pageIndex !== 0 || liveXts.length === 0) return fetched;

    const updatedHashes = new Set(liveXts.map((item) => item.xtHash));
    return [
      ...liveXts.filter((item) => filter === 'all' || item.status === filter),
      ...fetched.filter((item) => !updatedHashes.has(item.xtHash)),
    ]
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, PAGE_SIZE);
  }, [automaticRefresh, filter, liveXts, page.data?.items, pageIndex]);

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
    items,
    page: pageIndex + 1,
    loading: page.isPending || page.isPlaceholderData,
    error: page.error instanceof Error ? page.error.message : null,
    hasNewer: pageIndex > 0,
    hasOlder: page.data?.nextCursor != null,
    showNewer,
    showOlder,
    resetPagination,
    refetch: page.refetch,
  };
}
