import type { RouteVolume } from '@cross-scout/sdk';
import type { ChainView } from '../lib/chains';
import { chainById, chainView } from '../lib/chains';
import { fmt, weiToEth } from '../lib/format';
import { EmptyPanel, Glyph } from './primitives';

export type FlowMode = 'volume' | 'transfers';

function routeWeight(route: RouteVolume, mode: FlowMode): number {
  return mode === 'transfers' ? route.transfers : weiToEth(route.valueWei);
}

function weightLabel(value: number, mode: FlowMode): string {
  if (mode === 'transfers') return fmt(value);
  if (value === 0) return '0 ETH';
  if (value < 0.0001) return `${value.toExponential(2)} ETH`;
  return `${value.toFixed(4)} ETH`;
}

export function FlowChart({
  routes,
  chains,
  mode,
  empty = 'waiting for cross-chain activity...',
}: {
  routes: RouteVolume[];
  chains: ChainView[];
  mode: FlowMode;
  empty?: string;
}) {
  const byId = chainById(chains);
  const weighted = routes
    .map((route) => ({ route, weight: routeWeight(route, mode) }))
    .filter((item) => item.weight > 0);
  // Routes with traffic but zero weight under the active metric (token-only
  // legs in volume mode) still draw as hairlines so connectivity stays
  // visible; they just carry no share.
  const ghosts = routes.filter(
    (route) => route.transfers > 0 && routeWeight(route, mode) === 0,
  );

  const sideTotals = (side: 'srcChain' | 'dstChain') => {
    const totals = new Map<number, number>();
    for (const { route, weight } of weighted) {
      const id = route[side];
      totals.set(id, (totals.get(id) ?? 0) + weight);
    }
    for (const route of ghosts) {
      const id = route[side];
      if (!totals.has(id)) totals.set(id, 0);
    }
    return [...totals.entries()]
      .map(([id, value]) => ({ chain: chainView(byId, id), value }))
      .sort((a, b) => b.value - a.value);
  };

  const sources = sideTotals('srcChain');
  const targets = sideTotals('dstChain');
  const total = Math.max(
    sources.reduce((sum, item) => sum + item.value, 0),
    Number.EPSILON,
  );

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

  if (weighted.length === 0 && ghosts.length === 0) {
    return (
      <div className="flow-card">
        <div className="flow-labels">
          <span>Source</span>
          <span>Target</span>
        </div>
        <EmptyPanel>{empty}</EmptyPanel>
      </div>
    );
  }

  return (
    <div className="flow-card">
      <div className="flow-labels">
        <span>Source</span>
        <span>Target</span>
      </div>
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
            {ghosts.map((route) => {
              const sIdx = sourceIndex.get(route.srcChain) ?? 0;
              const tIdx = targetIndex.get(route.dstChain) ?? 0;
              const sy = maxRows === 1 ? height / 2 : 30 + sIdx * 54;
              const ty = maxRows === 1 ? height / 2 : 30 + tIdx * 54;
              return (
                <path
                  key={`ghost-${route.srcChain}-${route.dstChain}`}
                  d={`M 6 ${sy} C 350 ${sy}, 650 ${ty}, 994 ${ty}`}
                  fill="none"
                  stroke="var(--line-2)"
                  strokeWidth={2}
                  strokeDasharray="6 8"
                  strokeLinecap="round"
                  opacity={0.6}
                />
              );
            })}
            {weighted.map(({ route, weight }, idx) => {
              const sIdx = sourceIndex.get(route.srcChain) ?? 0;
              const tIdx = targetIndex.get(route.dstChain) ?? 0;
              const sy = maxRows === 1 ? height / 2 : 30 + sIdx * 54;
              const ty = maxRows === 1 ? height / 2 : 30 + tIdx * 54;
              const share = weight / total;
              const width = Math.max(14, Math.min(38, 14 + share * 24));
              const opacity = Math.max(0.28, Math.min(0.78, share));
              return (
                <path
                  key={`${route.srcChain}-${route.dstChain}`}
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
    </div>
  );
}
