import type { UseQueryResult } from '@tanstack/react-query';
import type {
  ActivityPoint,
  AssetVolume,
  Deposit,
  MailboxView,
  NetworkStats,
  NetworkView,
  RollupView,
  RouteVolume,
  Superblock,
  Withdrawal,
  Xt,
  XtDetail,
} from '@cross-scout/sdk';
import type { usePaginatedXts } from '../hooks/usePaginatedXts';
import type { useSuperblocks } from '../hooks/useSuperblocks';
import type { AnalyticsWindow } from '../lib/api';
import type { ChainView } from '../lib/chains';
import type { Page } from '../lib/nav';
import type { SuperblockFilter, XtFilter } from '../lib/status';
import { BridgePage } from '../pages/BridgePage';
import { MailboxPage } from '../pages/MailboxPage';
import { NetworkPage } from '../pages/NetworkPage';
import { OverviewPage } from '../pages/OverviewPage';
import { RollupDetailPage } from '../pages/RollupDetailPage';
import { RollupsPage } from '../pages/RollupsPage';
import { SuperblockDetailPage } from '../pages/SuperblockDetailPage';
import { SuperblocksPage } from '../pages/SuperblocksPage';
import { TransactionsPage } from '../pages/TransactionsPage';
import { TxDetailPage } from '../pages/TxDetailPage';

interface AppRoutesProps {
  page: Page;
  // data
  filteredTransactionXts: Xt[];
  byId: Map<number, ChainView>;
  xtCounts: Record<XtFilter, number>;
  transactionTotal: number;
  filteredDeposits: Deposit[];
  filteredWithdrawals: Withdrawal[];
  bridgeLoading: boolean;
  selectedXt: Xt | null;
  selectedDetail: XtDetail | null;
  detail: UseQueryResult<XtDetail>;
  networkView: NetworkView | null;
  networkLoading: boolean;
  filteredSuperblocks: Superblock[];
  selectedSuperblock: Superblock | null;
  superblockDetail: UseQueryResult<Superblock>;
  chainIds: number[];
  stats: NetworkStats | null;
  activeChain: number | null;
  mailbox: MailboxView | null;
  paneLoading: boolean;
  filteredRecentXts: Xt[];
  rollup: RollupView | null;
  chains: ChainView[];
  activity: ActivityPoint[];
  routes: RouteVolume[];
  assets: AssetVolume[];
  analyticsWindow: AnalyticsWindow;
  setAnalyticsWindow: (window: AnalyticsWindow) => void;
  coreLoading: boolean;
  // pagination handles
  transactionPages: ReturnType<typeof usePaginatedXts>;
  superblockPages: ReturnType<typeof useSuperblocks>;
  // ui state + handlers
  xtFilter: XtFilter;
  selectXtFilter: (filter: XtFilter) => void;
  streamUp: boolean;
  transactionsPaused: boolean;
  setTransactionUpdatesPaused: (paused: boolean) => void;
  sbFilter: SuperblockFilter;
  selectSuperblockFilter: (filter: SuperblockFilter) => void;
  nav: (next: Page) => void;
  goSuperblock: (sbOrNumber: Superblock | number) => void;
}

export function AppRoutes({
  page,
  filteredTransactionXts,
  byId,
  xtFilter,
  selectXtFilter,
  streamUp,
  transactionsPaused,
  setTransactionUpdatesPaused,
  xtCounts,
  transactionTotal,
  transactionPages,
  filteredDeposits,
  filteredWithdrawals,
  bridgeLoading,
  selectedXt,
  selectedDetail,
  detail,
  nav,
  goSuperblock,
  networkView,
  networkLoading,
  filteredSuperblocks,
  sbFilter,
  selectSuperblockFilter,
  superblockPages,
  selectedSuperblock,
  superblockDetail,
  chainIds,
  stats,
  activeChain,
  mailbox,
  paneLoading,
  filteredRecentXts,
  rollup,
  chains,
  activity,
  routes,
  assets,
  analyticsWindow,
  setAnalyticsWindow,
  coreLoading,
}: AppRoutesProps) {
  switch (page) {
    case 'txs':
      return (
        <TransactionsPage
          xts={filteredTransactionXts}
          chains={byId}
          filter={xtFilter}
          setFilter={selectXtFilter}
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
    case 'bridge':
      return (
        <BridgePage
          deposits={filteredDeposits}
          withdrawals={filteredWithdrawals}
          chains={byId}
          loading={bridgeLoading}
        />
      );
    case 'txDetail':
      return (
        <TxDetailPage
          xt={selectedXt}
          detail={selectedDetail}
          loading={detail.isPending}
          chains={byId}
          back={() => nav('txs')}
          onSuperblock={goSuperblock}
        />
      );
    case 'network':
      return <NetworkPage view={networkView} loading={networkLoading} />;
    case 'superblocks':
      return (
        <SuperblocksPage
          superblocks={filteredSuperblocks}
          chains={byId}
          filter={sbFilter}
          setFilter={selectSuperblockFilter}
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
    case 'superblockDetail':
      return (
        <SuperblockDetailPage
          sb={selectedSuperblock}
          loading={superblockDetail.isPending}
          chains={byId}
          back={() => nav('superblocks')}
        />
      );
    case 'mailbox':
      return (
        <MailboxPage
          chainIds={chainIds}
          chains={byId}
          hostChain={stats?.hostChain ?? null}
          selectedChain={activeChain}
          mailbox={mailbox}
          loading={paneLoading}
        />
      );
    case 'rollups':
      return (
        <RollupsPage
          chainIds={chainIds}
          chains={byId}
          hostChain={stats?.hostChain ?? null}
          xts={filteredRecentXts}
        />
      );
    case 'rollupDetail':
      return (
        <RollupDetailPage
          chainId={activeChain}
          chains={byId}
          hostChain={stats?.hostChain ?? null}
          xts={filteredRecentXts}
          mailbox={mailbox}
          rollup={rollup}
          loading={paneLoading}
          back={() => nav('rollups')}
        />
      );
    default:
      return (
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
}
