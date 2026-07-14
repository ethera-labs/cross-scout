import { useDeferredValue, useMemo } from 'react';
import type { Deposit, Superblock, Withdrawal, Xt } from '@cross-scout/sdk';
import { chainName } from '../lib/format';

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

/** Client-side filter of the visible lists by the header search query. */
export function useSearchFilters(
  query: string,
  lists: {
    recentXts: Xt[];
    transactionXts: Xt[];
    superblocks: Superblock[];
    deposits: Deposit[];
    withdrawals: Withdrawal[];
  },
) {
  const normalizedQuery = useDeferredValue(query.trim().toLowerCase());
  const { recentXts, transactionXts, superblocks, deposits, withdrawals } = lists;

  const filteredRecentXts = useMemo(
    () => filterXts(recentXts, normalizedQuery),
    [normalizedQuery, recentXts],
  );
  const filteredTransactionXts = useMemo(
    () => filterXts(transactionXts, normalizedQuery),
    [normalizedQuery, transactionXts],
  );
  const filteredSuperblocks = useMemo(
    () => filterSuperblocks(superblocks, normalizedQuery),
    [normalizedQuery, superblocks],
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

  return { filteredRecentXts, filteredTransactionXts, filteredSuperblocks, filteredDeposits, filteredWithdrawals };
}
