import type { MailboxView, RollupView, Xt } from '@cross-scout/sdk';
import { BackButton, EmptyPanel, Glyph, SectionTitle } from '../components/primitives';
import { mailboxAnchor, TxRow } from '../components/rows';
import type { ChainView } from '../lib/chains';
import { chainView } from '../lib/chains';
import { fmt, formatEthCompact, sumWei } from '../lib/format';

export function RollupDetailPage({
  chainId,
  chains,
  hostChain,
  xts,
  mailbox,
  rollup,
  loading,
  back,
  onSelectXt,
}: {
  chainId: number | null;
  chains: Map<number, ChainView>;
  hostChain: number | null;
  xts: Xt[];
  mailbox: MailboxView | null;
  rollup: RollupView | null;
  loading: boolean;
  back: () => void;
  onSelectXt: (hash: string) => void;
}) {
  const chain = chainView(chains, chainId);
  const related = xts.filter(
    (xt) => xt.srcChain === chainId || xt.dstChain === chainId || (chainId != null && xt.chains.includes(chainId)),
  );
  const messages = mailbox?.messages ?? [];
  const volume = formatEthCompact(sumWei(related.map((xt) => xt.valueWei)));

  return (
    <>
      <BackButton onClick={back}>Rollups</BackButton>
      <div className="detail-hero compact rollup-detail-hero">
        <Glyph chain={chain} size={52} />
        <div>
          <strong>{chain.name}</strong>
          <span className="mono muted">chain #{chain.id} - settles into {chainView(chains, hostChain).name}</span>
        </div>
        <span className="consistency"><i />active</span>
      </div>
      <div className="stats-grid small">
        <div className="stat-cell">
          <span className="stat-label mono">Cross-chain XTs</span>
          <strong className="stat-value mono">{fmt(rollup?.xtCount ?? related.length)}</strong>
        </div>
        <div className="stat-cell">
          <span className="stat-label mono">Volume</span>
          <strong className="stat-value mono">{volume}</strong>
        </div>
        <div className="stat-cell">
          <span className="stat-label mono">Inbox / Outbox</span>
          <strong className="stat-value mono">{fmt(mailbox?.inCount ?? 0)} / {fmt(mailbox?.outCount ?? 0)}</strong>
        </div>
        <div className="stat-cell">
          <span className="stat-label mono">Committed</span>
          <strong className="stat-value mono">{fmt(rollup?.committed ?? 0)}</strong>
        </div>
      </div>
      <section className="panel panel-spaced">
        <h3>Mailbox Anchors With {chainView(chains, hostChain).name}</h3>
        <div className="root-grid standalone">
          <div>
            <span className="mono">Latest Inbox Block</span>
            <strong className="mono">{mailboxAnchor(messages, 'in')}</strong>
          </div>
          <div>
            <span className="mono">Latest Outbox Block</span>
            <strong className="mono">{mailboxAnchor(messages, 'out')}</strong>
          </div>
        </div>
      </section>
      <SectionTitle title="Recent cross-chain transactions" />
      {rollup?.recentXts.length || related.length ? (
        <div className="tx-feed">
          {(rollup?.recentXts.length ? rollup.recentXts : related).slice(0, 8).map((xt) => (
            <TxRow key={xt.xtHash} xt={xt} chains={chains} onClick={() => onSelectXt(xt.xtHash)} />
          ))}
        </div>
      ) : (
        <EmptyPanel>{loading ? 'loading rollup...' : 'no transactions for this rollup yet'}</EmptyPanel>
      )}
    </>
  );
}
