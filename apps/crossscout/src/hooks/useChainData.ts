import { skipToken, useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Page } from '../lib/nav';

export function useChainData(page: Page, chainId: number | null) {
  const mailboxActive = chainId != null && (page === 'mailbox' || page === 'rollupDetail');
  const rollupActive = chainId != null && page === 'rollupDetail';

  const mailbox = useQuery({
    queryKey: ['mailbox', chainId],
    queryFn: chainId == null ? skipToken : () => api.getMailbox(chainId),
    enabled: mailboxActive,
  });

  const rollup = useQuery({
    queryKey: ['rollup', chainId],
    queryFn: chainId == null ? skipToken : () => api.getRollup(chainId),
    enabled: rollupActive,
  });

  return {
    mailbox: mailbox.data ?? null,
    rollup: rollup.data ?? null,
    loading:
      (mailboxActive && mailbox.isPending) ||
      (rollupActive && rollup.isPending),
  };
}
