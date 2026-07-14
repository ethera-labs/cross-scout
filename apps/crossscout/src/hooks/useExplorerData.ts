import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { StreamEvent, Xt } from '@cross-scout/sdk';
import type { AnalyticsWindow } from '../lib/api';
import { api } from '../lib/api';
import type { Page } from '../lib/nav';

const POLL_INTERVAL_MS = 15_000;

export function useExplorerData(page: Page, analyticsWindow: AnalyticsWindow) {
  const queryClient = useQueryClient();
  const [streamUp, setStreamUp] = useState(false);
  const [liveXts, setLiveXts] = useState<Xt[]>([]);
  const recentXtsActive = page === 'rollups' || page === 'rollupDetail';

  const stats = useQuery({
    queryKey: ['stats'],
    queryFn: () => api.getStats(),
    refetchInterval: streamUp ? false : POLL_INTERVAL_MS,
  });

  const recentXts = useQuery({
    queryKey: ['recentXts'],
    queryFn: () => api.listXts({ limit: 100 }).then(({ items }) => items),
    enabled: recentXtsActive,
    refetchInterval: recentXtsActive && !streamUp ? POLL_INTERVAL_MS : false,
  });

  const analytics = useQuery({
    queryKey: ['analytics', analyticsWindow],
    queryFn: async () => {
      const [activity, routes, assets] = await Promise.all([
        api.getActivity({ window: analyticsWindow }),
        api.getRoutes(analyticsWindow),
        api.getAssets(analyticsWindow),
      ]);
      return { activity, routes, assets };
    },
    enabled: page === 'overview',
    refetchInterval: page === 'overview' ? 30_000 : false,
  });

  const bridge = useQuery({
    queryKey: ['bridge'],
    queryFn: async () => {
      const [deposits, withdrawals] = await Promise.all([
        api.listDeposits({ limit: 100 }).then(({ items }) => items),
        api.listWithdrawals({ limit: 100 }).then(({ items }) => items),
      ]);
      return { deposits, withdrawals };
    },
    enabled: page === 'bridge',
    refetchInterval: page === 'bridge' ? POLL_INTERVAL_MS : false,
  });

  const network = useQuery({
    queryKey: ['network'],
    queryFn: () => api.getNetwork(),
  });

  useEffect(() => {
    const pendingKeys = new Set<string>();
    let flushTimer: number | undefined;
    const flush = () => {
      flushTimer = undefined;
      for (const key of pendingKeys) void queryClient.invalidateQueries({ queryKey: [key] });
      pendingKeys.clear();
    };
    // Broad invalidations coalesce so a busy stream refreshes aggregates at
    // most once per window instead of once per event.
    const queueInvalidate = (...keys: string[]) => {
      for (const key of keys) pendingKeys.add(key);
      flushTimer ??= window.setTimeout(flush, 2000);
    };

    const stream = api.stream((event: StreamEvent) => {
      if (event.type === 'newXt' || event.type === 'xtUpdated') {
        setLiveXts((current) =>
          [event.xt, ...current.filter((item) => item.xtHash !== event.xt.xtHash)]
            .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
            .slice(0, 50),
        );
        queryClient.setQueryData<Xt[]>(['recentXts'], (current) =>
          current
            ? [event.xt, ...current.filter((item) => item.xtHash !== event.xt.xtHash)]
                .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
                .slice(0, 100)
            : current,
        );
        void queryClient.invalidateQueries({ queryKey: ['xt', event.xt.xtHash] });
        queueInvalidate('mailbox', 'rollup', 'stats');
      } else {
        queryClient.setQueryData(['superblock', event.superblock.number], event.superblock);
        queueInvalidate('superblocks', 'network', 'stats');
      }
    }, setStreamUp);

    return () => {
      stream.close();
      if (flushTimer != null) window.clearTimeout(flushTimer);
    };
  }, [queryClient]);

  const firstError = [
    stats.error,
    recentXts.error,
  ].find((error) => error != null);

  return {
    stats: stats.data ?? null,
    xts: recentXts.data ?? [],
    deposits: bridge.data?.deposits ?? [],
    withdrawals: bridge.data?.withdrawals ?? [],
    activity: analytics.data?.activity ?? [],
    routes: analytics.data?.routes ?? [],
    assets: analytics.data?.assets ?? [],
    networkView: network.data ?? null,
    liveXts,
    streamUp,
    coreLoading: stats.isPending,
    bridgeLoading: bridge.isPending && page === 'bridge',
    networkLoading: network.isPending,
    error: firstError instanceof Error ? firstError.message : firstError ? String(firstError) : null,
  };
}
