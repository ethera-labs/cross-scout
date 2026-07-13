import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { skipToken, useQuery } from '@tanstack/react-query';
import type { Superblock, Xt } from '@cross-scout/sdk';
import { AppHeader } from './components/AppHeader';
import { useChainData } from './hooks/useChainData';
import { useExplorerData } from './hooks/useExplorerData';
import { usePaginatedXts } from './hooks/usePaginatedXts';
import { useSuperblocks } from './hooks/useSuperblocks';
import type { AnalyticsWindow } from './lib/api';
import { api } from './lib/api';
import { chainById, makeChains } from './lib/chains';
import { chainName } from './lib/format';
import type { Page, Theme } from './lib/nav';
import type { SuperblockFilter, XtFilter } from './lib/status';
import { BridgePage } from './pages/BridgePage';
import { MailboxPage } from './pages/MailboxPage';
import { NetworkPage } from './pages/NetworkPage';
import { OverviewPage } from './pages/OverviewPage';
import { RollupDetailPage } from './pages/RollupDetailPage';
import { RollupsPage } from './pages/RollupsPage';
import { SuperblockDetailPage } from './pages/SuperblockDetailPage';
import { SuperblocksPage } from './pages/SuperblocksPage';
import { TransactionsPage } from './pages/TransactionsPage';
import { TxDetailPage } from './pages/TxDetailPage';

const THEME_KEY = 'crossscout.theme';

function initialTheme(): Theme {
  const saved = window.localStorage.getItem(THEME_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function filterSuperblocks(superblocks: Superblock[], query: string): Superblock[] {
  if (!query) return superblocks;
  return superblocks.filter((superblock) =>
    [
      superblock.number,
      superblock.hash,
      superblock.parentHash,
      superblock.rootClaim,
      superblock.l1Tx,
    ]
      .filter((value) => value != null)
      .some((value) => String(value).toLowerCase().includes(query)),
  );
}

function filterXts(xts: Xt[], query: string): Xt[] {
  if (!query) return xts;
  return xts.filter((xt) =>
    [xt.xtHash, xt.sender, xt.receiver, xt.label, chainName(xt.srcChain), chainName(xt.dstChain)]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query)),
  );
}

export function App() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [page, setPage] = useState<Page>('overview');
  const [query, setQuery] = useState('');
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [analyticsWindow, setAnalyticsWindow] = useState<AnalyticsWindow>('24h');
  const [selectedChain, setSelectedChain] = useState<number | null>(null);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [selectedSuperblockNumber, setSelectedSuperblockNumber] = useState<number | null>(null);
  const [xtFilter, setXtFilter] = useState<XtFilter>('all');
  const [sbFilter, setSbFilter] = useState<SuperblockFilter>('all');
  const [transactionsPaused, setTransactionsPaused] = useState(false);

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

  const chainIds = useMemo(() => {
    const ids = new Set<number>();
    if (stats?.hostChain) ids.add(stats.hostChain);
    for (const route of stats?.routes ?? []) {
      ids.add(route.srcChain);
      ids.add(route.dstChain);
    }
    const indexedXts = [
      ...recentXts,
      ...transactionPages.items,
      ...(selectedDetail ? [selectedDetail.xt] : []),
    ];
    for (const xt of indexedXts) {
      for (const id of xt.chains) ids.add(id);
      if (xt.srcChain != null) ids.add(xt.srcChain);
      if (xt.dstChain != null) ids.add(xt.dstChain);
    }
    for (const deposit of deposits) ids.add(deposit.l2ChainId);
    for (const withdrawal of withdrawals) ids.add(withdrawal.l2ChainId);
    const host = stats?.hostChain;
    return [...ids].sort((a, b) => {
      if (host != null && a === host) return -1;
      if (host != null && b === host) return 1;
      return a - b;
    });
  }, [deposits, recentXts, selectedDetail, stats, transactionPages.items, withdrawals]);

  const chains = useMemo(() => makeChains(chainIds, stats?.hostChain), [chainIds, stats?.hostChain]);
  const byId = useMemo(() => chainById(chains), [chains]);
  const defaultChain = chainIds.find((id) => id !== stats?.hostChain) ?? chainIds[0] ?? null;
  const activeChain =
    selectedChain != null && chainIds.includes(selectedChain) ? selectedChain : defaultChain;
  const chainData = useChainData(page, activeChain);
  const { mailbox, rollup, loading: paneLoading } = chainData;

  const nav = (next: Page) => {
    setPage(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const goTx = (xtOrHash: Xt | string) => {
    setSelectedHash(typeof xtOrHash === 'string' ? xtOrHash : xtOrHash.xtHash);
    setPage('txDetail');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const goSuperblock = (sbOrNumber: Superblock | number) => {
    setSelectedSuperblockNumber(typeof sbOrNumber === 'number' ? sbOrNumber : sbOrNumber.number);
    setPage('superblockDetail');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const goRollup = (chain: number) => {
    setSelectedChain(chain);
    setPage('rollupDetail');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const searchJump = () => {
    const q = query.trim();
    if (!q) return;
    const norm = /^[0-9a-fA-F]{40}$|^[0-9a-fA-F]{64}$/.test(q) ? `0x${q}` : q;
    void api
      .search(norm)
      .then(({ results }) => {
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
      })
      .catch(() => undefined);
  };

  const normalizedQuery = query.trim().toLowerCase();
  const filteredRecentXts = useMemo(
    () => filterXts(recentXts, normalizedQuery),
    [normalizedQuery, recentXts],
  );
  const filteredTransactionXts = useMemo(
    () => filterXts(transactionPages.items, normalizedQuery),
    [normalizedQuery, transactionPages.items],
  );
  const filteredSuperblocks = useMemo(
    () => filterSuperblocks(superblockPages.items, normalizedQuery),
    [normalizedQuery, superblockPages.items],
  );
  const filteredDeposits = useMemo(() => {
    if (!normalizedQuery) return deposits;
    return deposits.filter((deposit) =>
      [
        deposit.sourceHash,
        deposit.sender,
        deposit.receiver,
        chainName(deposit.l2ChainId),
        deposit.status,
      ]
        .some((value) => String(value).toLowerCase().includes(normalizedQuery)),
    );
  }, [deposits, normalizedQuery]);

  const filteredWithdrawals = useMemo(() => {
    if (!normalizedQuery) return withdrawals;
    return withdrawals.filter((withdrawal) =>
      [
        withdrawal.withdrawalHash,
        withdrawal.sender,
        withdrawal.target,
        chainName(withdrawal.l2ChainId),
        withdrawal.status,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedQuery)),
    );
  }, [normalizedQuery, withdrawals]);

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

  let content: ReactNode;
  switch (page) {
    case 'txs':
      content = (
        <TransactionsPage
          xts={filteredTransactionXts}
          chains={byId}
          filter={xtFilter}
          setFilter={selectXtFilter}
          onTx={goTx}
          live={streamUp}
          paused={transactionsPaused}
          setPaused={setTransactionUpdatesPaused}
          counts={xtCounts}
          total={transactionTotal}
          page={transactionPages.page}
          loading={transactionPages.loading}
          hasNewer={transactionPages.hasNewer}
          hasOlder={transactionPages.hasOlder}
          onNewer={transactionPages.showNewer}
          onOlder={transactionPages.showOlder}
        />
      );
      break;
    case 'bridge':
      content = (
        <BridgePage
          deposits={filteredDeposits}
          withdrawals={filteredWithdrawals}
          chains={byId}
          loading={bridgeLoading}
        />
      );
      break;
    case 'txDetail':
      content = (
        <TxDetailPage
          xt={selectedXt}
          detail={selectedDetail}
          loading={detail.isPending}
          chains={byId}
          back={() => nav('txs')}
          onSuperblock={goSuperblock}
        />
      );
      break;
    case 'network':
      content = <NetworkPage view={networkView} loading={networkLoading} />;
      break;
    case 'superblocks':
      content = (
        <SuperblocksPage
          superblocks={filteredSuperblocks}
          chains={byId}
          filter={sbFilter}
          setFilter={selectSuperblockFilter}
          onSuperblock={goSuperblock}
          total={superblockPages.total}
          counts={superblockPages.counts}
          page={superblockPages.page}
          loading={superblockPages.loading}
          hasNewer={superblockPages.hasNewer}
          hasOlder={superblockPages.hasOlder}
          onNewer={superblockPages.showNewer}
          onOlder={superblockPages.showOlder}
        />
      );
      break;
    case 'superblockDetail':
      content = (
        <SuperblockDetailPage
          sb={selectedSuperblock}
          loading={superblockDetail.isPending}
          chains={byId}
          back={() => nav('superblocks')}
        />
      );
      break;
    case 'mailbox':
      content = (
        <MailboxPage
          chainIds={chainIds}
          chains={byId}
          hostChain={stats?.hostChain ?? null}
          selectedChain={activeChain}
          mailbox={mailbox}
          loading={paneLoading}
          onSelectChain={setSelectedChain}
        />
      );
      break;
    case 'rollups':
      content = (
        <RollupsPage
          chainIds={chainIds}
          chains={byId}
          hostChain={stats?.hostChain ?? null}
          xts={filteredRecentXts}
          onSelectChain={goRollup}
        />
      );
      break;
    case 'rollupDetail':
      content = (
        <RollupDetailPage
          chainId={activeChain}
          chains={byId}
          hostChain={stats?.hostChain ?? null}
          xts={filteredRecentXts}
          mailbox={mailbox}
          rollup={rollup}
          loading={paneLoading}
          back={() => nav('rollups')}
          onSelectXt={goTx}
        />
      );
      break;
    default:
      content = (
        <OverviewPage
          stats={stats}
          activity={activity}
          routes={routes}
          assets={assets}
          window={analyticsWindow}
          setWindow={setAnalyticsWindow}
          chains={chains}
          byId={byId}
          loading={coreLoading && !streamUp}
          onTxs={() => nav('txs')}
        />
      );
  }

  return (
    <div className="app-shell" data-theme={theme}>
      <AppHeader
        page={page}
        theme={theme}
        setTheme={selectTheme}
        query={query}
        setQuery={setQuery}
        onSearchSubmit={searchJump}
        chains={chains}
        switcherOpen={switcherOpen}
        setSwitcherOpen={setSwitcherOpen}
        nav={nav}
        onSelectRollup={goRollup}
        activeChainId={page === 'rollupDetail' ? activeChain : null}
        showNetwork={networkView?.publisher != null}
      />
      <main>
        {(error ?? pageError) && <div className="no-results">{error ?? pageError}</div>}
        {content}
      </main>
    </div>
  );
}
