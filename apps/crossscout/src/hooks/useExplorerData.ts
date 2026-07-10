import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ActivityPoint,
  AssetVolume,
  Deposit,
  NetworkStats,
  NetworkView,
  RouteVolume,
  StreamEvent,
  Superblock,
  Withdrawal,
  Xt,
} from '@cross-scout/sdk';
import type { AnalyticsWindow } from '../lib/api';
import { api } from '../lib/api';
import type { Page } from '../lib/nav';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function firstError(results: PromiseSettledResult<unknown>[]): string | null {
  const failed = results.find((result) => result.status === 'rejected');
  return failed?.status === 'rejected' ? errorMessage(failed.reason) : null;
}

function sortXts(xts: Xt[]): Xt[] {
  return [...xts].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

function upsertXt(xts: Xt[], xt: Xt): Xt[] {
  return sortXts([xt, ...xts.filter((item) => item.xtHash !== xt.xtHash)]).slice(0, 200);
}

export function useExplorerData(
  page: Page,
  analyticsWindow: AnalyticsWindow,
  onSuperblockUpdate: (superblock: Superblock) => void,
) {
  const [stats, setStats] = useState<NetworkStats | null>(null);
  const [xts, setXts] = useState<Xt[]>([]);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [activity, setActivity] = useState<ActivityPoint[]>([]);
  const [routes, setRoutes] = useState<RouteVolume[]>([]);
  const [assets, setAssets] = useState<AssetVolume[]>([]);
  const [networkView, setNetworkView] = useState<NetworkView | null>(null);
  const [streamUp, setStreamUp] = useState(false);
  const [coreLoading, setCoreLoading] = useState(true);
  const [bridgeLoading, setBridgeLoading] = useState(false);
  const [networkLoading, setNetworkLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const loadedCore = useRef(false);
  const coreReady = stats != null;

  const refreshCore = useCallback(async (showLoading: boolean, xtLimit: number | null) => {
    if (showLoading) setCoreLoading(true);

    const statsRequest = api
      .getStats()
      .then(setStats)
      .finally(() => {
        if (showLoading) setCoreLoading(false);
      });
    const requests: Array<Promise<unknown>> = [statsRequest];
    if (xtLimit != null) {
      requests.push(api.listXts({ limit: xtLimit }).then(({ items }) => setXts(sortXts(items))));
    }
    const results = await Promise.allSettled(requests);
    setError(firstError(results));
  }, []);

  useEffect(() => {
    const xtLimit = page === 'overview' ? 20 : page === 'rollups' || page === 'rollupDetail' ? 100 : null;
    const showLoading = !loadedCore.current;
    loadedCore.current = true;
    void refreshCore(showLoading, xtLimit);
    const id = window.setInterval(() => {
      void refreshCore(false, xtLimit);
    }, 15_000);
    return () => window.clearInterval(id);
  }, [page, refreshCore]);

  const refreshAnalytics = useCallback(async () => {
    await Promise.allSettled([
      api.getActivity({ window: analyticsWindow }).then(setActivity),
      api.getRoutes(analyticsWindow).then(setRoutes),
      api.getAssets(analyticsWindow).then(setAssets),
    ]);
  }, [analyticsWindow]);

  useEffect(() => {
    if (page !== 'overview' || !coreReady) return;
    void refreshAnalytics();
    const id = window.setInterval(() => {
      void refreshAnalytics();
    }, 30_000);
    return () => window.clearInterval(id);
  }, [coreReady, page, refreshAnalytics]);

  const refreshBridge = useCallback(async (showLoading: boolean) => {
    if (showLoading) setBridgeLoading(true);
    await Promise.allSettled([
      api.listDeposits({ limit: 100 }).then(({ items }) => setDeposits(items)),
      api.listWithdrawals({ limit: 100 }).then(({ items }) => setWithdrawals(items)),
    ]);
    if (showLoading) setBridgeLoading(false);
  }, []);

  useEffect(() => {
    if (page !== 'bridge') return;
    void refreshBridge(true);
    const id = window.setInterval(() => {
      void refreshBridge(false);
    }, 15_000);
    return () => window.clearInterval(id);
  }, [page, refreshBridge]);

  useEffect(() => {
    if (!coreReady) return;
    let active = true;
    void api
      .getNetwork()
      .then((view) => {
        if (active) setNetworkView(view);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setNetworkLoading(false);
      });
    return () => {
      active = false;
    };
  }, [coreReady]);

  useEffect(() => {
    const stream = api.stream(
      (event: StreamEvent) => {
        if (event.type === 'newXt' || event.type === 'xtUpdated') {
          setXts((current) => upsertXt(current, event.xt));
        } else {
          onSuperblockUpdate(event.superblock);
        }
        setRefreshVersion((current) => current + 1);
        void api.getStats().then(setStats).catch(() => undefined);
      },
      setStreamUp,
    );
    return () => stream.close();
  }, [onSuperblockUpdate]);

  return {
    stats,
    xts,
    deposits,
    withdrawals,
    activity,
    routes,
    assets,
    networkView,
    streamUp,
    coreLoading,
    bridgeLoading,
    networkLoading,
    error,
    refreshVersion,
  };
}
