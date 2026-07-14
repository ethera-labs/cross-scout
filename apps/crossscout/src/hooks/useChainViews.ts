import { useMemo } from 'react';
import type { Deposit, NetworkStats, Withdrawal, Xt, XtDetail } from '@cross-scout/sdk';
import type { ChainView } from '../lib/chains';
import { chainById, makeChains } from '../lib/chains';

/** Every chain id visible in currently loaded data, host chain first. */
export function useChainViews({
  stats,
  recentXts,
  transactionXts,
  selectedDetail,
  deposits,
  withdrawals,
}: {
  stats: NetworkStats | null;
  recentXts: Xt[];
  transactionXts: Xt[];
  selectedDetail: XtDetail | null;
  deposits: Deposit[];
  withdrawals: Withdrawal[];
}) {
  const chainIds = useMemo(() => {
    const ids = new Set<number>();
    if (stats?.hostChain) ids.add(stats.hostChain);
    for (const route of stats?.routes ?? []) {
      ids.add(route.srcChain);
      ids.add(route.dstChain);
    }
    const indexedXts = [
      ...recentXts,
      ...transactionXts,
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
  }, [deposits, recentXts, selectedDetail, stats, transactionXts, withdrawals]);

  const chains = useMemo(() => makeChains(chainIds, stats?.hostChain), [chainIds, stats?.hostChain]);
  const byId = useMemo(() => chainById(chains), [chains]);
  const defaultChain = chainIds.find((id) => id !== stats?.hostChain) ?? chainIds[0] ?? null;

  return { chainIds, chains, byId, defaultChain };
}
