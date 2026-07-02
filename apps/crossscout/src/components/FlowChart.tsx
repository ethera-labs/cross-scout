import type { Xt } from '@cross-scout/sdk';
import type { ChainView } from '../lib/chains';
import { chainById, chainView } from '../lib/chains';
import { fmt } from '../lib/format';
import { EmptyPanel, Glyph } from './primitives';

export type FlowMode = 'volume' | 'transfers';

/** Weight of one XT under the active mode: 1 per transfer, or its ETH value. */
function xtWeight(xt: Xt, mode: FlowMode): number {
  if (mode === 'transfers') return 1;
  if (!xt.valueWei) return 0;
  try {
    return Number(BigInt(xt.valueWei) / 1_000_000_000n) / 1e9;
  } catch {
    return 0;
  }
}

function weightLabel(value: number, mode: FlowMode): string {
  if (mode === 'transfers') return fmt(value);
  if (value === 0) return '0 ETH';
  if (value < 0.0001) return `${value.toExponential(2)} ETH`;
  return `${value.toFixed(4)} ETH`;
}

export function FlowChart({ xts, chains, mode }: { xts: Xt[]; chains: ChainView[]; mode: FlowMode }) {
  const byId = chainById(chains);
  const sources = chains
    .map((chain) => ({
      chain,
      value: xts.reduce((sum, xt) => (xt.srcChain === chain.id ? sum + xtWeight(xt, mode) : sum), 0),
    }))
    .filter((item) => item.value > 0);
  const targets = chains
    .map((chain) => ({
      chain,
      value: xts.reduce((sum, xt) => (xt.dstChain === chain.id ? sum + xtWeight(xt, mode) : sum), 0),
    }))
    .filter((item) => item.value > 0);
  const total = Math.max(
    sources.reduce((sum, item) => sum + item.value, 0),
    Number.EPSILON,
  );

  const pairs = new Map<string, { src: ChainView; dst: ChainView; value: number }>();
  for (const xt of xts) {
    if (xt.srcChain == null || xt.dstChain == null) continue;
    const weight = xtWeight(xt, mode);
    if (weight === 0) continue;
    const src = chainView(byId, xt.srcChain);
    const dst = chainView(byId, xt.dstChain);
    const key = `${src.id}:${dst.id}`;
    const current = pairs.get(key) ?? { src, dst, value: 0 };
    current.value += weight;
    pairs.set(key, current);
  }

  const maxRows = Math.max(sources.length, targets.length, 1);
  const height = Math.max(260, maxRows * 54 + 22);
  const sourceIndex = new Map(sources.map((item, idx) => [item.chain.id, idx]));
  const targetIndex = new Map(targets.map((item, idx) => [item.chain.id, idx]));

  const nodeRow = (item: { chain: ChainView; value: number }, side: 'source' | 'target') => {
    const pct = Math.round((item.value / total) * 100);
    return (
      <div className="flow-node" key={`${side}-${item.chain.id}`}>
        <Glyph chain={item.chain} />
        <strong>{item.chain.name}</strong>
        <span className="flow-spacer" />
        <span className="mono">{weightLabel(item.value, mode)}</span>
        <span className="flow-pct">{pct}%</span>
      </div>
    );
  };

  const empty =
    xts.length === 0
      ? 'waiting for cross-chain activity...'
      : pairs.size === 0
        ? 'no bridged value in the current window'
        : null;

  return (
    <div className="flow-card">
      <div className="flow-labels">
        <span>Source</span>
        <span>Target</span>
      </div>
      {empty ? (
        <EmptyPanel>{empty}</EmptyPanel>
      ) : (
        <div className="flow-layout" style={{ minHeight: height }}>
          <div className="flow-side" style={{ justifyContent: maxRows === 1 ? 'center' : undefined }}>
            {sources.map((item) => nodeRow(item, 'source'))}
          </div>
          <div className="flow-canvas">
            <svg viewBox={`0 0 1000 ${height}`} preserveAspectRatio="none" width="100%" height={height}>
              <defs>
                <linearGradient id="flowGrad" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" stopColor="var(--accent)" />
                  <stop offset="1" stopColor="var(--accent-2)" />
                </linearGradient>
              </defs>
              {Array.from(pairs.values()).map((pair, idx) => {
                const sIdx = sourceIndex.get(pair.src.id) ?? 0;
                const tIdx = targetIndex.get(pair.dst.id) ?? 0;
                const sy = maxRows === 1 ? height / 2 : 30 + sIdx * 54;
                const ty = maxRows === 1 ? height / 2 : 30 + tIdx * 54;
                const share = pair.value / total;
                const width = Math.max(14, Math.min(38, 14 + share * 24));
                const opacity = Math.max(0.28, Math.min(0.78, share));
                return (
                  <path
                    key={`${pair.src.id}-${pair.dst.id}`}
                    className="flow-path"
                    d={`M 6 ${sy} C 350 ${sy}, 650 ${ty}, 994 ${ty}`}
                    fill="none"
                    stroke="url(#flowGrad)"
                    strokeWidth={width}
                    strokeLinecap="round"
                    opacity={opacity}
                    style={{ animationDelay: `${idx * 80}ms` }}
                  />
                );
              })}
            </svg>
            <span className="flow-watermark mono">CROSSSCOUT</span>
          </div>
          <div className="flow-side" style={{ justifyContent: maxRows === 1 ? 'center' : undefined }}>
            {targets.map((item) => nodeRow(item, 'target'))}
          </div>
        </div>
      )}
    </div>
  );
}
