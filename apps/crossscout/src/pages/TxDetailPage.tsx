import { useState } from 'react';
import type { Xt, XtDetail } from '@cross-scout/sdk';
import { BackButton, DetailMeta, EmptyPanel, Glyph, PanelHeader, StatusPill } from '../components/primitives';
import { MessageRow } from '../components/rows';
import { AddTokenButton, TokenLogo } from '../components/TokenAsset';
import { Timeline } from '../components/Timeline';
import { apiBaseUrl } from '../lib/api';
import type { ChainView } from '../lib/chains';
import { chainSequence, chainView } from '../lib/chains';
import { clock, formatEthCompact, formatFee, shortHex, stageName, timeAgo, withUsd } from '../lib/format';
import { tokenFor, tokenSymbol, transferAmount } from '../lib/tokens';
import { Button } from '../ui/Button';
import { CopyButton } from '../ui/CopyButton';

type DetailTab = 'overview' | 'advanced' | 'progress';

const tabs: Array<[DetailTab, string]> = [
  ['overview', 'Overview'],
  ['advanced', 'Advanced'],
  ['progress', 'Progress'],
];

function FieldRow({ label, value, copy }: { label: string; value: string; copy?: string | null }) {
  return (
    <div className="advanced-row">
      <span className="mono">{label}</span>
      <strong className="mono">{value}</strong>
      {copy && <CopyButton value={copy} />}
    </div>
  );
}

export function TxDetailPage({
  xt,
  detail,
  loading,
  chains,
  back,
  onSuperblock,
}: {
  xt: Xt | null;
  detail: XtDetail | null;
  loading: boolean;
  chains: Map<number, ChainView>;
  back: () => void;
  onSuperblock: (number: number) => void;
}) {
  const [tab, setTab] = useState<DetailTab>('overview');
  const current = detail?.xt ?? xt;
  if (!current) {
    return (
      <>
        <BackButton onClick={back}>Transactions</BackButton>
        <EmptyPanel>{loading ? 'loading transaction...' : 'transaction not found'}</EmptyPanel>
      </>
    );
  }

  const route = chainSequence(current, chains);
  const participants = detail?.instance?.participants.length
    ? detail.instance.participants
    : current.chains;
  const mailbox = detail?.mailbox ?? [];
  const transfers = detail?.transfers ?? [];
  const tokens = detail?.tokens ?? [];
  const decision = detail?.instance?.decision ?? 'pending';

  const deliveryMsg = mailbox.find((message) => message.direction === 'in' && message.txHash);
  const completeAt = current.finalizedAt ?? current.settledAt ?? current.includedAt;
  const committedChains = new Set(mailbox.map((message) => message.chainId));
  const protocols = ['Universal Bridge Mailbox', ...(transfers.length ? ['Compose L2-L2 Bridge'] : [])];
  const curl = `curl -s ${apiBaseUrl}/v1/xts/${current.xtHash}`;

  const coordinationPanel = (
    <section className="panel">
      <PanelHeader
        title="2PC Coordination"
        value={
          decision === 'pending' && committedChains.size === 0
            ? 'pending'
            : `${committedChains.size}/${participants.length} chains committed`
        }
      />
      <div className="mini-list">
        {participants.length ? (
          participants.map((chainId) => {
            const chain = chainView(chains, chainId);
            const evidence = mailbox.filter((message) => message.chainId === chainId);
            const sealed = evidence.length > 0;
            const aborted = decision === 'abort';
            return (
              <div className="mini-row" key={chainId}>
                <Glyph chain={chain} />
                <strong>{chain.name}</strong>
                <span className="mono muted">
                  {sealed
                    ? `sealed ${clock(evidence[0]?.ts)}`
                    : aborted
                      ? 'no inclusion'
                      : 'awaiting inclusion'}
                </span>
                <span className={sealed ? 'decision commit' : aborted ? 'decision abort' : 'decision'}>
                  {sealed ? 'COMMITTED' : aborted ? 'ABORTED' : 'PENDING'}
                </span>
              </div>
            );
          })
        ) : (
          <EmptyPanel>participants unknown until a signal lands</EmptyPanel>
        )}
        <p className="offchain-note">
          Votes are exchanged off-chain between the sequencers and the publisher; committed means the
          chain sealed its mailbox writes.
        </p>
      </div>
    </section>
  );

  const superblockPanel = (
    <section className="panel">
      <h3>Settlement</h3>
      <div className="mini-list">
        {detail?.superblock ? (
          <>
            <FieldRow
              label="Superblock"
              value={`#${detail.superblock.number} (${detail.superblock.status})`}
            />
            {detail.superblock.gameAddress && (
              <FieldRow
                label="Dispute Game"
                value={shortHex(detail.superblock.gameAddress, 8, 6)}
                copy={detail.superblock.gameAddress}
              />
            )}
            {detail.superblock.l1Tx && (
              <FieldRow label="L1 Tx" value={shortHex(detail.superblock.l1Tx, 8, 6)} copy={detail.superblock.l1Tx} />
            )}
            {detail.superblock.l1TxFee && <FieldRow label="L1 Fee" value={formatFee(detail.superblock.l1TxFee)} />}
            {detail.superblock.chains.map((block) => {
              const chain = chainView(chains, block.chainId);
              return (
                <div className="block-row" key={block.chainId}>
                  <div>
                    <Glyph chain={chain} size={22} />
                    <strong>{chain.name}</strong>
                    <span className="mono">{block.l2Block == null ? 'L2 pending' : `L2 #${block.l2Block}`}</span>
                  </div>
                  <small className="mono">
                    {shortHex(block.preRoot)} -&gt; {shortHex(block.postRoot)}
                  </small>
                </div>
              );
            })}
            <Button variant="subtle" size="sm" onClick={() => onSuperblock(detail.superblock!.number)}>
              View superblock
            </Button>
          </>
        ) : (
          <EmptyPanel>not yet settled into a superblock</EmptyPanel>
        )}
      </div>
    </section>
  );

  return (
    <>
      <BackButton onClick={back}>Transactions</BackButton>
      <div className="detail-tabs">
        {tabs.map(([item, label]) => (
          <Button key={item} variant="subtle" size="sm" active={tab === item} onClick={() => setTab(item)}>
            {label}
          </Button>
        ))}
      </div>
      <div className="detail-hero">
        <div className="detail-hero-top">
          <div className="hero-status">
            <StatusPill status={current.status} large />
            <span className="mono muted">
              {timeAgo(current.updatedAt)} - {clock(current.updatedAt)}
            </span>
          </div>
          <div className="hash-chip">
            <span className="mono">Session</span>
            <strong className="mono">{shortHex(current.xtHash, 8, 5)}</strong>
            <CopyButton value={current.xtHash} />
          </div>
        </div>
        <div className="route-diagram">
          {route.map((chain, idx) => (
            <div className="route-diagram-item" key={`${chain.id}-${idx}`}>
              <div
                className="route-node"
                style={{
                  color: chain.color,
                  borderColor: chain.color,
                  background: `${chain.color}1f`,
                  boxShadow: `0 0 30px ${chain.color}55`,
                }}
              >
                {chain.glyph}
              </div>
              <strong>{chain.name}</strong>
              <span>{idx === 0 ? 'source' : idx === route.length - 1 ? 'target' : 'hop'}</span>
              {idx < route.length - 1 && <i />}
            </div>
          ))}
        </div>
        <DetailMeta
          rows={[
            ['Stage', stageName(current.stage)],
            ['Action', current.label ?? 'message'],
            ['Initial Time', clock(current.firstSeenAt)],
            ['Complete Time', completeAt ? clock(completeAt) : 'pending'],
            ['Superblock', current.superblockNumber ? `#${current.superblockNumber}` : 'pending'],
            ['Protocols', protocols.join(' + ')],
          ]}
        />
      </div>

      {tab === 'overview' && (
        <>
          <section className="panel panel-spaced">
            <h3>Transaction</h3>
            <div className="mini-list">
              <FieldRow
                label="Source Tx"
                value={current.srcTxHash ? shortHex(current.srcTxHash, 10, 8) : 'pending'}
                copy={current.srcTxHash}
              />
              <FieldRow
                label="Delivery Tx"
                value={deliveryMsg?.txHash ? shortHex(deliveryMsg.txHash, 10, 8) : 'pending'}
                copy={deliveryMsg?.txHash}
              />
              <FieldRow label="Destination Fee" value={formatFee(deliveryMsg?.txFee)} />
              {transfers.length ? (
                transfers.map((transfer) => {
                  const src = chainView(chains, transfer.srcChain);
                  const dst = chainView(chains, transfer.dstChain);
                  const token = tokenFor(transfer, tokens);
                  return (
                    <div className="action-row" key={transfer.id}>
                      <span className="action-asset">
                        <TokenLogo transfer={transfer} tokens={tokens} />
                        <span>
                          <strong>{tokenSymbol(transfer, tokens)}</strong>
                          <small className="mono">
                            {transfer.kind === 'eth' ? 'native' : token?.name ?? shortHex(transfer.token, 6, 4)}
                          </small>
                        </span>
                      </span>
                      <span className="mono action-type">{transfer.kind === 'eth' ? 'ETH TRANSFER' : 'TOKEN TRANSFER'}</span>
                      <span className="action-leg">
                        <Glyph chain={src} size={18} />
                        <strong className="mono">{shortHex(transfer.sender, 6, 4)}</strong>
                        <CopyButton value={transfer.sender} />
                      </span>
                      <span className="tx-direction" aria-hidden="true">
                        -&gt;
                      </span>
                      <span className="action-leg">
                        <Glyph chain={dst} size={18} />
                        <strong className="mono">{shortHex(transfer.receiver, 6, 4)}</strong>
                        <CopyButton value={transfer.receiver} />
                      </span>
                      <span className="action-row-actions">
                        {transfer.kind === 'erc20' && <AddTokenButton token={token} />}
                        <strong className="action-amount mono">{transferAmount(transfer, tokens)}</strong>
                      </span>
                    </div>
                  );
                })
              ) : (
                <FieldRow label="Action" value={current.label ?? 'mailbox message'} />
              )}
              {current.valueWei && <FieldRow label="Value" value={withUsd(formatEthCompact(current.valueWei), current.valueUsd)} />}
            </div>
          </section>
          <div className="two-col">
            <section className="panel">
              <h3>Lifecycle</h3>
              <Timeline xt={current} />
            </section>
            <div className="stack">
              {coordinationPanel}
              {superblockPanel}
            </div>
          </div>
          <section className="panel panel-spaced">
            <h3>Mailbox Messages</h3>
            <div className="message-list">
              {mailbox.length ? (
                mailbox.map((message) => <MessageRow key={message.id} message={message} chains={chains} />)
              ) : (
                <EmptyPanel>{loading ? 'loading mailbox messages...' : 'no mailbox messages yet'}</EmptyPanel>
              )}
            </div>
          </section>
        </>
      )}

      {tab === 'advanced' && (
        <>
          <section className="panel panel-spaced">
            <h3>API Request</h3>
            <div className="curl-block">
              <code className="mono">{curl}</code>
              <CopyButton value={curl} />
            </div>
          </section>
          <section className="panel panel-spaced">
            <div className="panel-header">
              <h3>Raw Response</h3>
              <CopyButton value={JSON.stringify(detail ?? current, null, 2)} />
            </div>
            <pre className="raw-json mono">{JSON.stringify(detail ?? current, null, 2)}</pre>
          </section>
          <section className="panel panel-spaced">
            <h3>Observed Signals</h3>
            <div className="mini-list">
              {mailbox.length || transfers.length ? (
                <>
                  {transfers.map((transfer) => {
                    const chain = chainView(chains, transfer.chainId);
                    return (
                      <div className="block-row" key={`t-${transfer.id}`}>
                        <div>
                          <Glyph chain={chain} size={22} />
                          <strong>bridge {transfer.kind === 'eth' ? 'eth' : 'token'} transfer</strong>
                          <span className="mono">{transferAmount(transfer, tokens)}</span>
                        </div>
                        <small className="mono">
                          {transfer.txHash ? shortHex(transfer.txHash, 8, 6) : shortHex(transfer.session, 8, 6)} -{' '}
                          {clock(transfer.ts)}
                        </small>
                      </div>
                    );
                  })}
                  {mailbox.map((message) => {
                    const chain = chainView(chains, message.chainId);
                    return (
                      <div className="block-row" key={`m-${message.id}`}>
                        <div>
                          <Glyph chain={chain} size={22} />
                          <strong>
                            {message.direction === 'in' ? 'inbox write' : 'outbox write'} - {message.label ?? 'message'}
                          </strong>
                          <span className="mono">log {message.logIndex}</span>
                        </div>
                        <small className="mono">
                          {message.txHash ? shortHex(message.txHash, 8, 6) : shortHex(message.blockHash, 8, 6)} -{' '}
                          {clock(message.ts)}
                        </small>
                      </div>
                    );
                  })}
                </>
              ) : (
                <EmptyPanel>no sealed signals recorded yet</EmptyPanel>
              )}
            </div>
          </section>
        </>
      )}

      {tab === 'progress' && (
        <div className="two-col">
          <section className="panel">
            <h3>Lifecycle</h3>
            <Timeline xt={current} />
          </section>
          <div className="stack">{coordinationPanel}</div>
        </div>
      )}
    </>
  );
}
