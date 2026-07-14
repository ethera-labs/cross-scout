import type { Xt } from '@cross-scout/sdk';
import { Glyph } from '../components/primitives';
import type { ChainView } from '../lib/chains';
import { chainView } from '../lib/chains';
import { fmt, formatEthCompact, sumWei } from '../lib/format';
import { rollupHref } from '../lib/nav';

export function RollupsPage({
  chainIds,
  chains,
  hostChain,
  xts,
}: {
  chainIds: number[];
  chains: Map<number, ChainView>;
  hostChain: number | null;
  xts: Xt[];
}) {
  return (
    <>
      <div className="intro-line">
        <p>Rollups settling into the {chainView(chains, hostChain).name} network.</p>
        <span className="mono">{chainIds.length} rollups in view</span>
      </div>
      <div className="rollup-grid">
        {chainIds.map((id) => {
          const chain = chainView(chains, id);
          const current = id === hostChain;
          const related = xts.filter(
            (xt) => xt.srcChain === id || xt.dstChain === id || xt.chains.includes(id),
          );
          const volume = formatEthCompact(sumWei(related.map((xt) => xt.valueWei)));
          return (
            <a className={current ? 'rollup-card current' : 'rollup-card'} key={id} href={rollupHref(id)}>
              <div className="rollup-card-head">
                <Glyph chain={chain} size={40} />
                <div>
                  <strong>{chain.name}</strong>
                  <span className="mono">chain #{id}</span>
                </div>
                <small className="mono">{current ? 'THIS ROLLUP' : 'COUNTERPARTY'}</small>
              </div>
              <div className="rollup-stats">
                <div><span>XTs</span><strong className="mono">{fmt(related.length)}</strong></div>
                <div><span>Volume</span><strong className="mono">{volume}</strong></div>
                <div><span>Status</span><strong className="mono">{current ? 'host' : 'active'}</strong></div>
                <div><span>Mailbox</span><strong className="ok-text">{related.length ? 'observed' : 'pending'}</strong></div>
              </div>
            </a>
          );
        })}
      </div>
    </>
  );
}
