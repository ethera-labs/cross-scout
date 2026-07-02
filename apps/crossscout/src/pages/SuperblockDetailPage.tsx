import type { Superblock, SuperblockStatus } from '@cross-scout/sdk';
import { BackButton, DetailMeta, EmptyPanel, Glyph, StatusPill } from '../components/primitives';
import type { ChainView } from '../lib/chains';
import { chainView } from '../lib/chains';
import { clock, fmt, formatDurationMs, shortHex, timeAgo } from '../lib/format';
import { statusVar, superblockLabels } from '../lib/status';
import { LogoIcon } from '../ui/icons';

export function SuperblockDetailPage({
  sb,
  loading,
  chains,
  back,
}: {
  sb: Superblock | null;
  loading: boolean;
  chains: Map<number, ChainView>;
  back: () => void;
}) {
  const order: SuperblockStatus[] = ['proposed', 'validated', 'finalized'];
  const current = sb ? order.indexOf(sb.status) : -1;
  const age = sb?.finalizedAt ?? sb?.validatedAt ?? sb?.proposedAt;

  if (!sb) {
    return (
      <>
        <BackButton onClick={back}>Superblocks</BackButton>
        <EmptyPanel>{loading ? 'loading superblock...' : 'superblock not found'}</EmptyPanel>
      </>
    );
  }

  return (
    <>
      <BackButton onClick={back}>Superblocks</BackButton>
      <div className="detail-hero compact">
        <div className="sb-title">
          <div className="big-icon">
            <LogoIcon />
          </div>
          <div>
            <strong className="mono">#{sb.number}</strong>
            <span className="mono muted">superblock - {age ? timeAgo(age) : '-'}</span>
          </div>
        </div>
        <StatusPill status={sb.status} large />
        <div className="ladder">
          {order.map((status, idx) => (
            <div className="ladder-step" key={status}>
              <span
                className={idx <= current ? 'reached' : ''}
                style={{ background: idx <= current ? statusVar[status] : undefined }}
              />
              <strong>{superblockLabels[status]}</strong>
              {idx < order.length - 1 && <i className={idx < current ? 'reached' : ''} />}
            </div>
          ))}
        </div>
      </div>
      <DetailMeta
        rows={[
          ['Superblock Hash', shortHex(sb.hash)],
          ['Parent Hash', shortHex(sb.parentHash)],
          ['Root Claim', shortHex(sb.rootClaim)],
          ['Cross-chain XTs', String(sb.xtCount)],
          ['Prove Time', formatDurationMs(sb.proveMs)],
          ['L1 Anchor', sb.l1Tx ? shortHex(sb.l1Tx) : 'pending'],
          ['L1 Block', sb.l1Block ? `#${fmt(sb.l1Block)}` : '-'],
          ['Proposed', sb.proposedAt ? clock(sb.proposedAt) : '-'],
        ]}
      />
      <div className="two-col sb-detail-grid">
        <section className="panel">
          <h3>State Transitions</h3>
          <div className="mini-list">
            {sb.chains.length ? (
              sb.chains.map((block) => {
                const chain = chainView(chains, block.chainId);
                return (
                  <div className="block-row wide" key={block.chainId}>
                    <div>
                      <Glyph chain={chain} />
                      <strong>{chain.name}</strong>
                      <span className="mono">{block.l2Block == null ? 'L2 pending' : `L2 #${fmt(block.l2Block)}`}</span>
                    </div>
                    <small className="mono">
                      {shortHex(block.preRoot)} -&gt; {shortHex(block.postRoot)} - cfg {shortHex(block.configHash)}
                    </small>
                  </div>
                );
              })
            ) : (
              <EmptyPanel>no chain transitions yet</EmptyPanel>
            )}
          </div>
        </section>
        <section className="panel">
          <h3>Validation Rules</h3>
          <div className="rule-list">
            {[
              ['State transitions valid for all chains', 0],
              ['Mailbox root consistent across inbox/outbox', 1],
              ['Superblock config hash matches on-chain', 1],
              ['Aggregated proof verified', 1],
              ['Anchored and finalized on Ethereum L1', 2],
            ].map(([text, need]) => (
              <div className="rule-row" key={String(text)}>
                <span className={current >= Number(need) ? 'ok' : ''}>{current >= Number(need) ? 'OK' : '..'}</span>
                <strong>{text}</strong>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
