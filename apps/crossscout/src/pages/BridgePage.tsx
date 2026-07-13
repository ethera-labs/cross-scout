import { useState } from 'react';
import type { Deposit, Withdrawal } from '@cross-scout/sdk';
import { EmptyPanel, Glyph } from '../components/primitives';
import type { ChainView } from '../lib/chains';
import { chainView } from '../lib/chains';
import { formatEthCompact, shortHex, timeAgo } from '../lib/format';
import { Button } from '../ui/Button';
import { CopyButton } from '../ui/CopyButton';

type BridgeTab = 'deposits' | 'withdrawals';

const depositCols = {
  gridTemplateColumns: '0.8fr 1.35fr 1.25fr 1.25fr 0.9fr 1fr 0.85fr',
};
const withdrawalCols = {
  gridTemplateColumns: '0.8fr 1.35fr 1.25fr 1.25fr 0.9fr 1fr 0.85fr',
};

function bridgeStatus(status: Deposit['status'] | Withdrawal['status']): { label: string; color: string; bg: string } {
  switch (status) {
    case 'finalized':
      return { label: 'Finalized', color: 'var(--ok)', bg: 'var(--ok-soft)' };
    case 'finalized_failed':
      return { label: 'Failed', color: 'var(--bad)', bg: 'var(--bad-soft)' };
    case 'proven':
      return { label: 'Proven', color: 'var(--info)', bg: 'var(--info-soft)' };
    default:
      return { label: 'Initiated', color: 'var(--accent)', bg: 'var(--accent-soft)' };
  }
}

function BridgePill({ status }: { status: Deposit['status'] | Withdrawal['status'] }) {
  const s = bridgeStatus(status);
  return (
    <span className="pill" style={{ color: s.color, background: s.bg }}>
      <span className="pill-dot" style={{ background: s.color, boxShadow: `0 0 8px ${s.color}` }} />
      {s.label}
    </span>
  );
}

function DepositRow({ deposit, chains }: { deposit: Deposit; chains: Map<number, ChainView> }) {
  const chain = chainView(chains, deposit.l2ChainId);
  return (
    <div className="dense-table-row" style={depositCols}>
      <span className="mono tx-time">{timeAgo(deposit.updatedAt)}</span>
      <span className="tx-hash-cell">
        <strong className="mono">{shortHex(deposit.sourceHash, 6, 6)}</strong>
        <CopyButton value={deposit.sourceHash} />
      </span>
      <span className="tx-address-cell">
        <Glyph chain={chain} size={18} />
        <span>
          <strong className="mono">{shortHex(deposit.sender, 6, 5)}</strong>
          <small>L1 sender</small>
        </span>
      </span>
      <span className="tx-address-cell">
        <span>
          <strong className="mono">{shortHex(deposit.receiver, 6, 5)}</strong>
          <small>L2 receiver</small>
        </span>
      </span>
      <span className="mono">{formatEthCompact(deposit.valueWei)}</span>
      <span className="tx-address-cell">
        <Glyph chain={chain} size={18} />
        <span>
          <strong>{chain.name}</strong>
          <small className="mono">{deposit.l2ChainId}</small>
        </span>
      </span>
      <BridgePill status={deposit.status} />
    </div>
  );
}

function WithdrawalRow({ withdrawal, chains }: { withdrawal: Withdrawal; chains: Map<number, ChainView> }) {
  const chain = chainView(chains, withdrawal.l2ChainId);
  const age = withdrawal.finalizedAt ?? withdrawal.provenAt ?? withdrawal.initiatedAt ?? withdrawal.updatedAt;
  return (
    <div className="dense-table-row" style={withdrawalCols}>
      <span className="mono tx-time">{timeAgo(age)}</span>
      <span className="tx-hash-cell">
        <strong className="mono">{shortHex(withdrawal.withdrawalHash, 6, 6)}</strong>
        <CopyButton value={withdrawal.withdrawalHash} />
      </span>
      <span className="tx-address-cell">
        <Glyph chain={chain} size={18} />
        <span>
          <strong className="mono">{shortHex(withdrawal.sender, 6, 5)}</strong>
          <small>L2 sender</small>
        </span>
      </span>
      <span className="tx-address-cell">
        <span>
          <strong className="mono">{shortHex(withdrawal.target, 6, 5)}</strong>
          <small>L1 target</small>
        </span>
      </span>
      <span className="mono">{formatEthCompact(withdrawal.valueWei)}</span>
      <span className="tx-address-cell">
        <Glyph chain={chain} size={18} />
        <span>
          <strong>{chain.name}</strong>
          <small className="mono">{withdrawal.l2ChainId}</small>
        </span>
      </span>
      <BridgePill status={withdrawal.status} />
    </div>
  );
}

export function BridgePage({
  deposits,
  withdrawals,
  chains,
  loading,
}: {
  deposits: Deposit[];
  withdrawals: Withdrawal[];
  chains: Map<number, ChainView>;
  loading: boolean;
}) {
  const [tab, setTab] = useState<BridgeTab>('deposits');
  const totals = {
    deposits: deposits.length,
    withdrawals: withdrawals.length,
  };
  const showingDeposits = tab === 'deposits';

  return (
    <>
      <div className="explorer-titlebar">
        <h2>Bridge</h2>
        <span className="live-mode mono">
          <i />
          OP STACK
          <b />
        </span>
      </div>
      <div className="page-toolbar">
        <div className="query-pills">
          <Button variant="facet" size="md" active={showingDeposits} onClick={() => setTab('deposits')}>
            Deposits
            <span className="mono filter-count">{totals.deposits}</span>
          </Button>
          <Button variant="facet" size="md" active={!showingDeposits} onClick={() => setTab('withdrawals')}>
            Withdrawals
            <span className="mono filter-count">{totals.withdrawals}</span>
          </Button>
        </div>
        <span className="mono result-count">
          {showingDeposits ? totals.deposits : totals.withdrawals} rows
        </span>
      </div>
      <div className="table-head dense" style={showingDeposits ? depositCols : withdrawalCols}>
        <span>Time</span>
        <span>{showingDeposits ? 'Source Hash' : 'Withdrawal Hash'}</span>
        <span>From</span>
        <span>To</span>
        <span>Value</span>
        <span>Rollup</span>
        <span>Status</span>
      </div>
      <div className="tx-dense-list">
        {showingDeposits ? (
          deposits.length ? (
            deposits.map((deposit) => (
              <DepositRow key={deposit.sourceHash} deposit={deposit} chains={chains} />
            ))
          ) : (
            <EmptyPanel>{loading ? 'loading deposits...' : 'no deposits observed yet'}</EmptyPanel>
          )
        ) : withdrawals.length ? (
          withdrawals.map((withdrawal) => (
            <WithdrawalRow key={withdrawal.withdrawalHash} withdrawal={withdrawal} chains={chains} />
          ))
        ) : (
          <EmptyPanel>{loading ? 'loading withdrawals...' : 'no withdrawals observed yet'}</EmptyPanel>
        )}
      </div>
    </>
  );
}
