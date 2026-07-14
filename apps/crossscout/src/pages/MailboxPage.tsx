import { useState } from 'react';
import type { MailboxView } from '@cross-scout/sdk';
import { EmptyPanel, Glyph } from '../components/primitives';
import { MailboxTableRow } from '../components/rows';
import { chainView, type ChainView } from '../lib/chains';
import { fmt } from '../lib/format';
import { mailboxAnchor } from '../lib/mailbox';
import { mailboxHref } from '../lib/nav';
import { Button } from '../ui/Button';

type DirectionFilter = 'all' | 'in' | 'out';

const directionLabels: Record<DirectionFilter, string> = {
  all: 'All directions',
  in: 'Inbox',
  out: 'Outbox',
};

export function MailboxPage({
  chainIds,
  chains,
  hostChain,
  selectedChain,
  mailbox,
  loading,
}: {
  chainIds: number[];
  chains: Map<number, ChainView>;
  hostChain: number | null;
  selectedChain: number | null;
  mailbox: MailboxView | null;
  loading: boolean;
}) {
  const [direction, setDirection] = useState<DirectionFilter>('all');
  const host = chainView(chains, hostChain);
  const sideIds = chainIds.filter((id) => id !== hostChain);
  const visibleIds = sideIds.length ? sideIds : chainIds;
  const activeId = selectedChain ?? visibleIds[0] ?? hostChain;
  const active = chainView(chains, activeId);
  const allMessages = mailbox?.messages ?? [];
  const messages =
    direction === 'all' ? allMessages : allMessages.filter((message) => message.direction === direction);

  return (
    <>
      <div className="explorer-titlebar">
        <h2>Mailbox</h2>
      </div>
      <div className="mailbox-layout">
        <aside className="side-list">
          <h3>Counterparties</h3>
          {visibleIds.map((id) => {
            const chain = chainView(chains, id);
            return (
              <a key={id} className={id === activeId ? 'side-item active' : 'side-item'} href={mailboxHref(id)}>
                <Glyph chain={chain} />
                <span>
                  <strong>{chain.name}</strong>
                  <small className="mono">{id}</small>
                </span>
              </a>
            );
          })}
        </aside>
        <section>
          <div className="mailbox-hero">
            <div className="mailbox-title">
              <Glyph chain={host} />
              <span>&lt;-&gt;</span>
              <Glyph chain={active} />
              <strong>{host.name} &lt;-&gt; {active.name}</strong>
            </div>
            <span className="consistency">
              <i />
              Observed
            </span>
            <div className="root-grid">
              <div>
                <span className="mono">Latest Inbox Block</span>
                <strong className="mono">{mailboxAnchor(allMessages, 'in')}</strong>
                <small className="mono">{fmt(mailbox?.inCount ?? 0)} msgs</small>
              </div>
              <div>
                <span className="mono">Latest Outbox Block</span>
                <strong className="mono">{mailboxAnchor(allMessages, 'out')}</strong>
                <small className="mono">{fmt(mailbox?.outCount ?? 0)} msgs</small>
              </div>
            </div>
          </div>
          <div className="page-toolbar mailbox-toolbar">
            <div className="query-pills">
              {(Object.keys(directionLabels) as DirectionFilter[]).map((item) => (
                <Button
                  key={item}
                  variant="facet"
                  size="md"
                  active={direction === item}
                  onClick={() => setDirection(item)}
                >
                  {directionLabels[item]}
                </Button>
              ))}
            </div>
            <span className="mono result-count">{messages.length} messages</span>
          </div>
          <div className="table-head mailbox-head dense">
            <span>Direction</span>
            <span>From</span>
            <span />
            <span>To</span>
            <span>Message</span>
            <span>Session</span>
            <span>Superblock</span>
            <span>Age</span>
          </div>
          <div className="tx-dense-list">
            {messages.length ? (
              messages.map((message) => <MailboxTableRow key={message.id} message={message} chains={chains} />)
            ) : (
              <EmptyPanel>{loading ? 'loading mailbox...' : 'no mailbox messages yet'}</EmptyPanel>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
