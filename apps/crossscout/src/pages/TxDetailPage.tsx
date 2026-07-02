import { useState } from 'react';
import type { MailboxMessage, Xt, XtDetail } from '@cross-scout/sdk';
import { BackButton, DetailMeta, EmptyPanel, Glyph, PanelHeader, StatusPill } from '../components/primitives';
import { MessageRow } from '../components/rows';
import { Timeline } from '../components/Timeline';
import type { ChainView } from '../lib/chains';
import { chainSequence, chainView } from '../lib/chains';
import { clock, fmt, formatEthCompact, shortHex, stageName, timeAgo } from '../lib/format';
import { Button } from '../ui/Button';
import { CopyButton } from '../ui/CopyButton';

type DetailTab = 'overview' | 'advanced' | 'progress';

const tabs: Array<[DetailTab, string]> = [
  ['overview', 'Overview'],
  ['advanced', 'Advanced'],
  ['progress', 'Progress'],
];

export function TxDetailPage({
  xt,
  detail,
  loading,
  chains,
  back,
}: {
  xt: Xt | null;
  detail: XtDetail | null;
  loading: boolean;
  chains: Map<number, ChainView>;
  back: () => void;
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
    ? detail.instance.participants.map((id) => chainView(chains, id))
    : route;
  const decision = detail?.instance?.decision ?? (current.status === 'failed' ? 'abort' : 'commit');
  const commitCount = decision === 'abort' ? Math.max(0, participants.length - 1) : participants.length;
  const mailbox = detail?.mailbox ?? [];
  const mailboxBlocks = Array.from(
    mailbox.reduce((map, message) => {
      if (!map.has(message.chainId)) map.set(message.chainId, message);
      return map;
    }, new Map<number, MailboxMessage>()),
  ).map(([, message]) => message);

  const votesPanel = (
    <section className="panel">
      <PanelHeader title="2PC Votes" value={`${commitCount}/${participants.length} commit`} />
      <div className="mini-list">
        {participants.length ? (
          participants.map((chain, idx) => {
            const vote = decision !== 'abort' || idx < commitCount;
            return (
              <div className="mini-row" key={`${chain.id}-${idx}`}>
                <Glyph chain={chain} />
                <strong>{chain.name}</strong>
                <span className="mono muted">{clock(detail?.instance?.decidedAt ?? current.updatedAt)}</span>
                <span className={vote ? 'decision commit' : 'decision abort'}>{vote ? 'COMMIT' : 'ABORT'}</span>
              </div>
            );
          })
        ) : (
          <EmptyPanel>no participant votes yet</EmptyPanel>
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
            <span className="mono muted">{timeAgo(current.updatedAt)} - {clock(current.updatedAt)}</span>
          </div>
          <div className="hash-chip">
            <span className="mono">XT Hash</span>
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
            ['Instance ID', shortHex(current.instanceId, 8, 6)],
            ['Stage', stageName(current.stage)],
            ['Sender', shortHex(current.sender, 8, 5)],
            ['Value', formatEthCompact(current.valueWei)],
            ['Superblock', current.superblockNumber ? `#${current.superblockNumber}` : 'pending'],
            ['Updated', clock(current.updatedAt)],
          ]}
        />
      </div>

      {tab === 'overview' && (
        <>
          <div className="two-col">
            <section className="panel">
              <h3>Lifecycle</h3>
              <Timeline xt={current} />
            </section>
            <div className="stack">
              {votesPanel}
              <section className="panel">
                <h3>Block State</h3>
                <div className="mini-list">
                  {detail?.superblock?.chains.length ? (
                    detail.superblock.chains.map((block) => {
                      const chain = chainView(chains, block.chainId);
                      return (
                        <div className="block-row" key={block.chainId}>
                          <div>
                            <Glyph chain={chain} size={22} />
                            <strong>{chain.name}</strong>
                            <span className="mono">{block.l2Block == null ? 'L2 pending' : `L2 #${fmt(block.l2Block)}`}</span>
                          </div>
                          <small className="mono">{shortHex(block.preRoot)} -&gt; {shortHex(block.postRoot)}</small>
                        </div>
                      );
                    })
                  ) : mailboxBlocks.length ? (
                    mailboxBlocks.map((message) => {
                      const chain = chainView(chains, message.chainId);
                      return (
                        <div className="block-row" key={`${message.chainId}-${message.blockHash}`}>
                          <div>
                            <Glyph chain={chain} size={22} />
                            <strong>{chain.name}</strong>
                            <span className="mono">log {message.logIndex}</span>
                          </div>
                          <small className="mono">{shortHex(message.blockHash)}</small>
                        </div>
                      );
                    })
                  ) : (
                    <EmptyPanel>block state pending</EmptyPanel>
                  )}
                </div>
              </section>
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
            <h3>Raw Fields</h3>
            <div className="mini-list">
              {(
                [
                  ['XT Hash', current.xtHash],
                  ['Instance ID', current.instanceId],
                  ['Sender', current.sender ?? '-'],
                  ['Value (wei)', current.valueWei ?? '0'],
                  ['Chains', current.chains.join(', ') || '-'],
                  ['Stage', `${current.stage} (${stageName(current.stage)})`],
                  ['Status', current.status],
                  ['First Seen', current.firstSeenAt],
                  ['Updated', current.updatedAt],
                ] as Array<[string, string]>
              ).map(([label, value]) => (
                <div className="advanced-row" key={label}>
                  <span className="mono">{label}</span>
                  <strong className="mono">{value}</strong>
                  <CopyButton value={value} />
                </div>
              ))}
            </div>
          </section>
          <section className="panel panel-spaced">
            <h3>Observed Signals</h3>
            <div className="mini-list">
              {mailbox.length ? (
                mailbox.map((message) => {
                  const chain = chainView(chains, message.chainId);
                  return (
                    <div className="block-row" key={message.id}>
                      <div>
                        <Glyph chain={chain} size={22} />
                        <strong>
                          {message.direction === 'in' ? 'inbox write' : 'outbox write'} - {message.label ?? 'message'}
                        </strong>
                        <span className="mono">log {message.logIndex}</span>
                      </div>
                      <small className="mono">
                        block {shortHex(message.blockHash)} - {clock(message.ts)}
                      </small>
                    </div>
                  );
                })
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
          <div className="stack">{votesPanel}</div>
        </div>
      )}
    </>
  );
}
