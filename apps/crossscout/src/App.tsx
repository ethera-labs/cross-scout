import { useEffect, useRef, useState } from 'react';
import { skipToken, useQuery } from '@tanstack/react-query';
import type { Superblock, Xt } from '@cross-scout/sdk';
import { AppHeader } from './components/AppHeader';
import { AppRoutes } from './components/AppRoutes';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useChainData } from './hooks/useChainData';
import { useChainViews } from './hooks/useChainViews';
import { useExplorerData } from './hooks/useExplorerData';
import { usePaginatedXts } from './hooks/usePaginatedXts';
import { useRoute } from './hooks/useRoute';
import { useSearchFilters } from './hooks/useSearchFilters';
import { useSuperblocks } from './hooks/useSuperblocks';
import type { AnalyticsWindow } from './lib/api';
import { api } from './lib/api';
import type { Page, Theme } from './lib/nav';
import { routeHash, routeTitle } from './lib/nav';
import type { SuperblockFilter, XtFilter } from './lib/status';

const THEME_KEY = 'crossscout.theme';

function initialTheme(): Theme {
  const saved = window.localStorage.getItem(THEME_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function App() {
  const { route, navigate } = useRoute();
  const page = route.page;
  const selectedChain = route.chain ?? null;
  const selectedHash = route.txHash ?? null;
  const selectedSuperblockNumber = route.superblock ?? null;
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [query, setQuery] = useState('');
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [analyticsWindow, setAnalyticsWindow] = useState<AnalyticsWindow>('24h');
  const [xtFilter, setXtFilter] = useState<XtFilter>('all');
  const [sbFilter, setSbFilter] = useState<SuperblockFilter>('all');
  const [transactionsPaused, setTransactionsPaused] = useState(false);
  const [searchNote, setSearchNote] = useState<string | null>(null);
  const searchSeq = useRef(0);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [page]);

  useEffect(() => {
    document.title = routeTitle(route);
  }, [route]);

  const superblockPages = useSuperblocks(page === 'superblocks', sbFilter);
  const explorer = useExplorerData(page, analyticsWindow);
  const transactionPages = usePaginatedXts({
    active: page === 'txs',
    filter: xtFilter,
    automaticRefresh: !transactionsPaused,
    liveXts: explorer.liveXts,
    polling: !explorer.streamUp,
  });
  const {
    stats,
    xts: recentXts,
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
  } = explorer;

  const detail = useQuery({
    queryKey: ['xt', selectedHash],
    queryFn: selectedHash == null ? skipToken : () => api.getXt(selectedHash),
    enabled: page === 'txDetail' && selectedHash != null,
  });
  const superblockDetail = useQuery({
    queryKey: ['superblock', selectedSuperblockNumber],
    queryFn:
      selectedSuperblockNumber == null
        ? skipToken
        : () => api.getSuperblock(selectedSuperblockNumber),
    enabled: page === 'superblockDetail' && selectedSuperblockNumber != null,
  });
  const selectedDetail = detail.data ?? null;

  const selectSuperblockFilter = (filter: SuperblockFilter) => {
    superblockPages.resetPagination();
    setSbFilter(filter);
  };

  const selectXtFilter = (filter: XtFilter) => {
    transactionPages.resetPagination();
    setXtFilter(filter);
  };

  const selectTheme = (next: Theme) => {
    window.localStorage.setItem(THEME_KEY, next);
    setTheme(next);
  };

  const { chainIds, chains, byId, defaultChain } = useChainViews({
    stats,
    recentXts,
    transactionXts: transactionPages.items,
    selectedDetail,
    deposits,
    withdrawals,
  });
  const activeChain =
    selectedChain != null && chainIds.includes(selectedChain) ? selectedChain : defaultChain;
  const chainData = useChainData(page, activeChain);
  const { mailbox, rollup, loading: paneLoading } = chainData;

  const nav = (next: Page) => navigate({ page: next });
  const goTx = (xtOrHash: Xt | string) =>
    navigate({ page: 'txDetail', txHash: typeof xtOrHash === 'string' ? xtOrHash : xtOrHash.xtHash });
  const goSuperblock = (sbOrNumber: Superblock | number) =>
    navigate({
      page: 'superblockDetail',
      superblock: typeof sbOrNumber === 'number' ? sbOrNumber : sbOrNumber.number,
    });
  const goRollup = (chain: number) => navigate({ page: 'rollupDetail', chain });

  const searchJump = () => {
    const q = query.trim();
    if (!q) return;
    const norm = /^[0-9a-fA-F]{40}$|^[0-9a-fA-F]{64}$/.test(q) ? `0x${q}` : q;
    const seq = ++searchSeq.current;
    setSearchNote(null);
    void api
      .search(norm)
      .then(({ results }) => {
        if (seq !== searchSeq.current) return;
        for (const result of results) {
          if (result.type === 'xt') {
            goTx(result.xt.xtHash);
            return;
          }
          if (result.type === 'superblock') {
            goSuperblock(result.superblock.number);
            return;
          }
          if (result.type === 'deposit' || result.type === 'withdrawal') {
            nav('bridge');
            return;
          }
          if (result.type === 'address') {
            nav('txs');
            return;
          }
        }
        setSearchNote(`no results for "${q}"`);
      })
      .catch(() => {
        if (seq === searchSeq.current) setSearchNote('search failed - indexer API unreachable');
      });
  };

  const updateQuery = (next: string) => {
    setQuery(next);
    setSearchNote(null);
  };

  const { filteredRecentXts, filteredTransactionXts, filteredSuperblocks, filteredDeposits, filteredWithdrawals } =
    useSearchFilters(query, {
      recentXts,
      transactionXts: transactionPages.items,
      superblocks: superblockPages.items,
      deposits,
      withdrawals,
    });

  const xtCounts: Record<XtFilter, number> = {
    all: stats?.totalXts ?? 0,
    pending: stats?.pending ?? 0,
    committed: stats?.committed ?? 0,
    validated: stats?.validated ?? 0,
    finalized: stats?.finalized ?? 0,
    failed: stats?.failed ?? 0,
  };
  const transactionTotal = xtFilter === 'all' ? xtCounts.all : xtCounts[xtFilter];
  const selectedXt = selectedHash
    ? selectedDetail?.xt ??
      transactionPages.items.find((xt) => xt.xtHash === selectedHash) ??
      recentXts.find((xt) => xt.xtHash === selectedHash) ??
      null
    : null;
  const selectedSuperblock =
    superblockDetail.data ??
    superblockPages.items.find((item) => item.number === selectedSuperblockNumber) ??
    null;
  const setTransactionUpdatesPaused = (paused: boolean) => {
    setTransactionsPaused(paused);
    if (!paused) void transactionPages.refetch();
  };
  const pageError =
    page === 'superblocks'
      ? superblockPages.error
      : page === 'txs'
        ? transactionPages.error
        : null;

  return (
    <div className="app-shell" data-theme={theme}>
      <AppHeader
        page={page}
        theme={theme}
        setTheme={selectTheme}
        query={query}
        setQuery={updateQuery}
        onSearchSubmit={searchJump}
        searchNote={searchNote}
        chains={chains}
        switcherOpen={switcherOpen}
        setSwitcherOpen={setSwitcherOpen}
        onSelectRollup={goRollup}
        activeChainId={page === 'rollupDetail' ? activeChain : null}
        showNetwork={networkView?.publisher != null}
      />
      <main>
        {(error ?? pageError) && <div className="no-results">{error ?? pageError}</div>}
        <ErrorBoundary resetKey={routeHash(route)}>
          <AppRoutes
            page={page}
            filteredTransactionXts={filteredTransactionXts}
            byId={byId}
            xtFilter={xtFilter}
            selectXtFilter={selectXtFilter}
            streamUp={streamUp}
            transactionsPaused={transactionsPaused}
            setTransactionUpdatesPaused={setTransactionUpdatesPaused}
            xtCounts={xtCounts}
            transactionTotal={transactionTotal}
            transactionPages={transactionPages}
            filteredDeposits={filteredDeposits}
            filteredWithdrawals={filteredWithdrawals}
            bridgeLoading={bridgeLoading}
            selectedXt={selectedXt}
            selectedDetail={selectedDetail}
            detail={detail}
            nav={nav}
            goSuperblock={goSuperblock}
            networkView={networkView}
            networkLoading={networkLoading}
            filteredSuperblocks={filteredSuperblocks}
            sbFilter={sbFilter}
            selectSuperblockFilter={selectSuperblockFilter}
            superblockPages={superblockPages}
            selectedSuperblock={selectedSuperblock}
            superblockDetail={superblockDetail}
            chainIds={chainIds}
            stats={stats}
            activeChain={activeChain}
            mailbox={mailbox}
            paneLoading={paneLoading}
            filteredRecentXts={filteredRecentXts}
            rollup={rollup}
            chains={chains}
            activity={activity}
            routes={routes}
            assets={assets}
            analyticsWindow={analyticsWindow}
            setAnalyticsWindow={setAnalyticsWindow}
            coreLoading={coreLoading}
          />
        </ErrorBoundary>
      </main>
    </div>
  );
}
