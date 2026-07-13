import { useCallback, useEffect, useRef, useState } from 'react';
import type { Xt } from '@cross-scout/sdk';
import { api } from '../lib/api';
import type { XtFilter } from '../lib/status';

const PAGE_SIZE = 50;
const POLL_INTERVAL_MS = 15_000;

export function usePaginatedXts({
  active,
  filter,
  automaticRefresh,
  liveXt,
  polling,
}: {
  active: boolean;
  filter: XtFilter;
  automaticRefresh: boolean;
  liveXt: Xt | null;
  polling: boolean;
}) {
  const [items, setItems] = useState<Xt[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<Array<string | undefined>>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const [pollVersion, setPollVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedRequest = useRef<string | null>(null);
  const wasAutomatic = useRef(automaticRefresh);
  const cursor = cursorHistory[pageIndex];

  useEffect(() => {
    if (!active) return;
    let current = true;
    const request = `${filter}:${pageIndex}:${cursor ?? ''}`;
    const showLoading = loadedRequest.current !== request;
    if (showLoading) setLoading(true);
    setError(null);
    void api
      .listXts({
        limit: PAGE_SIZE,
        cursor,
        status: filter === 'all' ? undefined : filter,
      })
      .then((result) => {
        if (!current) return;
        loadedRequest.current = request;
        setItems(result.items);
        setNextCursor(result.nextCursor);
      })
      .catch((reason: unknown) => {
        if (current) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (current && showLoading) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [active, cursor, filter, pageIndex, pollVersion]);

  useEffect(() => {
    if (!active || !automaticRefresh || pageIndex !== 0 || liveXt == null) return;
    setItems((current) => {
      const remaining = current.filter((item) => item.xtHash !== liveXt.xtHash);
      const matches = filter === 'all' || liveXt.status === filter;
      if (!matches) return remaining.length === current.length ? current : remaining;
      return [liveXt, ...remaining]
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
        .slice(0, PAGE_SIZE);
    });
  }, [active, automaticRefresh, filter, liveXt, pageIndex]);

  useEffect(() => {
    if (!active || !automaticRefresh || !polling || pageIndex !== 0) return;
    const id = window.setInterval(() => setPollVersion((current) => current + 1), POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [active, automaticRefresh, pageIndex, polling]);

  useEffect(() => {
    if (active && automaticRefresh && !wasAutomatic.current) {
      setPollVersion((current) => current + 1);
    }
    wasAutomatic.current = automaticRefresh;
  }, [active, automaticRefresh]);

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

  return {
    items,
    page: pageIndex + 1,
    loading,
    error,
    hasNewer: pageIndex > 0,
    hasOlder: nextCursor != null,
    showNewer,
    showOlder,
    resetPagination,
  };
}
