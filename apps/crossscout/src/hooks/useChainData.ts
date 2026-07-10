import { useEffect, useState } from 'react';
import type { MailboxView, RollupView } from '@cross-scout/sdk';
import { api } from '../lib/api';
import type { Page } from '../lib/nav';

export function useChainData(page: Page, chainId: number | null, refreshVersion: number) {
  const [mailbox, setMailbox] = useState<MailboxView | null>(null);
  const [rollup, setRollup] = useState<RollupView | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (chainId == null || (page !== 'mailbox' && page !== 'rollupDetail')) return;
    let active = true;
    setLoading(true);
    setMailbox(null);
    if (page === 'rollupDetail') setRollup(null);

    const requests: Promise<unknown>[] = [
      api.getMailbox(chainId).then((view) => {
        if (active) setMailbox(view);
      }),
    ];
    if (page === 'rollupDetail') {
      requests.push(
        api.getRollup(chainId).then((view) => {
          if (active) setRollup(view);
        }),
      );
    }

    void Promise.allSettled(requests).then(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [chainId, page, refreshVersion]);

  return { mailbox, rollup, loading };
}
