import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  MailboxView,
  NetworkStats,
  RollupView,
  StreamEvent,
  Superblock,
  Xt,
  XtDetail,
} from '@cross-scout/sdk';
import { AppHeader } from './components/AppHeader';
import { api } from './lib/api';
import { chainById, makeChains } from './lib/chains';
import { chainName } from './lib/format';
import type { Network, Page, Theme } from './lib/nav';
import type { SuperblockFilter, XtFilter } from './lib/status';
import { InstancesPage } from './pages/InstancesPage';
import { MailboxPage } from './pages/MailboxPage';
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

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sortXts(xts: Xt[]): Xt[] {
  return [...xts].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

function upsertXt(xts: Xt[], xt: Xt): Xt[] {
  return sortXts([xt, ...xts.filter((item) => item.xtHash !== xt.xtHash)]).slice(0, 200);
}

function upsertSuperblock(superblocks: Superblock[], next: Superblock): Superblock[] {
  return [next, ...superblocks.filter((item) => item.number !== next.number)].sort(
    (a, b) => b.number - a.number,
  );
}

function firstSettledError(results: PromiseSettledResult<unknown>[]): string | null {
  const failed = results.find((result) => result.status === 'rejected');
  return failed?.status === 'rejected' ? errMsg(failed.reason) : null;
}

export function App() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [network, setNetwork] = useState<Network>('Mainnet');
  const [page, setPage] = useState<Page>('overview');
  const [query, setQuery] = useState('');
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [stats, setStats] = useState<NetworkStats | null>(null);
  const [xts, setXts] = useState<Xt[]>([]);
  const [superblocks, setSuperblocks] = useState<Superblock[]>([]);
  const [mailbox, setMailbox] = useState<MailboxView | null>(null);
  const [rollup, setRollup] = useState<RollupView | null>(null);
  const [selectedChain, setSelectedChain] = useState<number | null>(null);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<XtDetail | null>(null);
  const [selectedSuperblockNumber, setSelectedSuperblockNumber] = useState<number | null>(null);
  const [selectedSuperblock, setSelectedSuperblock] = useState<Superblock | null>(null);
  const [xtFilter, setXtFilter] = useState<XtFilter>('all');
  const [sbFilter, setSbFilter] = useState<SuperblockFilter>('all');
  const [streamUp, setStreamUp] = useState(false);
  const [loading, setLoading] = useState(true);
  const [paneLoading, setPaneLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [superblockLoading, setSuperblockLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailVersion, setDetailVersion] = useState(0);

  useEffect(() => {
    window.localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const loadCore = useCallback(async () => {
    setLoading(true);
    const results = await Promise.allSettled([
      api.getStats(),
      api.listXts({ limit: 100 }),
      api.listSuperblocks(50),
    ]);

    const [statsResult, xtsResult, superblocksResult] = results;
    if (statsResult?.status === 'fulfilled') setStats(statsResult.value);
    if (xtsResult?.status === 'fulfilled') setXts(sortXts(xtsResult.value.items));
    if (superblocksResult?.status === 'fulfilled') setSuperblocks(superblocksResult.value);

    setError(firstSettledError(results));
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadCore();
    const id = window.setInterval(() => {
      void loadCore();
    }, 15_000);
    return () => window.clearInterval(id);
  }, [loadCore]);

  useEffect(() => {
    const stream = api.stream(
      (event: StreamEvent) => {
        if (event.type === 'newXt' || event.type === 'xtUpdated') {
          setXts((current) => upsertXt(current, event.xt));
        } else {
          setSuperblocks((current) => upsertSuperblock(current, event.superblock));
        }
        setDetailVersion((current) => current + 1);
        void api.getStats().then(setStats).catch(() => undefined);
      },
      (up) => setStreamUp(up),
    );
    return () => stream.close();
  }, []);

  const chainIds = useMemo(() => {
    const ids = new Set<number>();
    if (stats?.hostChain) ids.add(stats.hostChain);
    for (const route of stats?.routes ?? []) {
      ids.add(route.srcChain);
      ids.add(route.dstChain);
    }
    for (const xt of xts) {
      for (const id of xt.chains) ids.add(id);
      if (xt.srcChain != null) ids.add(xt.srcChain);
      if (xt.dstChain != null) ids.add(xt.dstChain);
    }
    const host = stats?.hostChain;
    return [...ids].sort((a, b) => {
      if (host != null && a === host) return -1;
      if (host != null && b === host) return 1;
      return a - b;
    });
  }, [stats, xts]);

  const chains = useMemo(() => makeChains(chainIds, stats?.hostChain), [chainIds, stats?.hostChain]);
  const byId = useMemo(() => chainById(chains), [chains]);

  useEffect(() => {
    const fallback = chainIds[0];
    const counterparty = chainIds.find((id) => id !== stats?.hostChain);
    const next = counterparty ?? fallback;
    if (next == null) return;
    if (selectedChain == null || !chainIds.includes(selectedChain)) setSelectedChain(next);
  }, [chainIds, selectedChain, stats?.hostChain]);

  useEffect(() => {
    if (selectedChain == null) return;
    let live = true;
    setPaneLoading(true);
    void Promise.allSettled([api.getMailbox(selectedChain), api.getRollup(selectedChain)])
      .then(([mailboxResult, rollupResult]) => {
        if (!live) return;
        setMailbox(mailboxResult.status === 'fulfilled' ? mailboxResult.value : null);
        setRollup(rollupResult.status === 'fulfilled' ? rollupResult.value : null);
      })
      .finally(() => {
        if (live) setPaneLoading(false);
      });
    return () => {
      live = false;
    };
  }, [selectedChain, detailVersion]);

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
    setSelectedSuperblock(typeof sbOrNumber === 'number' ? null : sbOrNumber);
    setPage('superblockDetail');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const goRollup = (chain: number) => {
    setSelectedChain(chain);
    setPage('rollupDetail');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  /** Enter in the search box: jump straight to an exact hash or superblock. */
  const searchJump = () => {
    const q = query.trim().toLowerCase();
    if (!q) return;
    const norm = q.startsWith('0x') ? q : `0x${q}`;
    const hit = xts.find(
      (xt) => xt.xtHash.toLowerCase() === norm || xt.instanceId.toLowerCase() === norm,
    );
    if (hit) {
      goTx(hit.xtHash);
      return;
    }
    if (/^\d+$/.test(q)) goSuperblock(Number(q));
  };

  useEffect(() => {
    if (page !== 'txDetail' || !selectedHash) {
      setSelectedDetail(null);
      setDetailLoading(false);
      return;
    }

    let live = true;
    setDetailLoading(true);
    void api.getXt(selectedHash)
      .then((detail) => {
        if (live) setSelectedDetail(detail);
      })
      .catch(() => {
        if (live) setSelectedDetail(null);
      })
      .finally(() => {
        if (live) setDetailLoading(false);
      });
    return () => {
      live = false;
    };
  }, [page, selectedHash, detailVersion]);

  useEffect(() => {
    if (page !== 'superblockDetail' || selectedSuperblockNumber == null) {
      setSuperblockLoading(false);
      return;
    }

    let live = true;
    setSuperblockLoading(true);
    void api.getSuperblock(selectedSuperblockNumber)
      .then((sb) => {
        if (live) setSelectedSuperblock(sb);
      })
      .catch(() => {
        if (live) setSelectedSuperblock(null);
      })
      .finally(() => {
        if (live) setSuperblockLoading(false);
      });
    return () => {
      live = false;
    };
  }, [page, selectedSuperblockNumber, detailVersion]);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredXts = useMemo(() => {
    if (!normalizedQuery) return xts;
    return xts.filter((xt) =>
      [xt.xtHash, xt.instanceId, xt.sender, chainName(xt.srcChain), chainName(xt.dstChain)]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedQuery)),
    );
  }, [normalizedQuery, xts]);

  const filteredSuperblocks = useMemo(() => {
    if (!normalizedQuery) return superblocks;
    return superblocks.filter((sb) =>
      [sb.number, sb.hash, sb.parentHash, sb.rootClaim, sb.l1Tx]
        .filter((value) => value != null)
        .some((value) => String(value).toLowerCase().includes(normalizedQuery)),
    );
  }, [normalizedQuery, superblocks]);

  const selectedXt = selectedHash ? xts.find((xt) => xt.xtHash === selectedHash) ?? null : null;

  let content: ReactNode;
  switch (page) {
    case 'txs':
      content = (
        <TransactionsPage
          xts={filteredXts}
          chains={byId}
          filter={xtFilter}
          setFilter={setXtFilter}
          onTx={goTx}
        />
      );
      break;
    case 'txDetail':
      content = (
        <TxDetailPage
          xt={selectedXt}
          detail={selectedDetail}
          loading={detailLoading}
          chains={byId}
          back={() => nav('txs')}
        />
      );
      break;
    case 'superblocks':
      content = (
        <SuperblocksPage
          superblocks={filteredSuperblocks}
          chains={byId}
          filter={sbFilter}
          setFilter={setSbFilter}
          onSuperblock={goSuperblock}
        />
      );
      break;
    case 'superblockDetail':
      content = (
        <SuperblockDetailPage
          sb={selectedSuperblock}
          loading={superblockLoading}
          chains={byId}
          back={() => nav('superblocks')}
        />
      );
      break;
    case 'instances':
      content = <InstancesPage xts={filteredXts} chains={byId} onTx={goTx} />;
      break;
    case 'mailbox':
      content = (
        <MailboxPage
          chainIds={chainIds}
          chains={byId}
          hostChain={stats?.hostChain ?? null}
          selectedChain={selectedChain}
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
          xts={filteredXts}
          onSelectChain={goRollup}
        />
      );
      break;
    case 'rollupDetail':
      content = (
        <RollupDetailPage
          chainId={selectedChain}
          chains={byId}
          hostChain={stats?.hostChain ?? null}
          xts={filteredXts}
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
          xts={filteredXts}
          superblocks={filteredSuperblocks}
          mailbox={mailbox}
          chains={chains}
          byId={byId}
          network={network}
          loading={loading && !streamUp}
          onTxs={() => nav('txs')}
          onTx={goTx}
          onSuperblock={goSuperblock}
        />
      );
  }

  return (
    <div className="app-shell" data-theme={theme}>
      <AppHeader
        page={page}
        theme={theme}
        setTheme={setTheme}
        network={network}
        setNetwork={setNetwork}
        query={query}
        setQuery={setQuery}
        onSearchSubmit={searchJump}
        chains={chains}
        switcherOpen={switcherOpen}
        setSwitcherOpen={setSwitcherOpen}
        nav={nav}
        onSelectRollup={goRollup}
        activeChainId={page === 'rollupDetail' ? selectedChain : null}
      />
      <main>
        {error && <div className="no-results">{error}</div>}
        {content}
      </main>
    </div>
  );
}
