import { useState } from 'react';
import type { RouteVolume } from '@cross-scout/sdk';
import type { ChainView } from '../lib/chains';
import { chainById, chainView } from '../lib/chains';
import { fmt, weiToEth } from '../lib/format';
import { EmptyPanel, Glyph } from './primitives';

export type FlowMode = 'volume' | 'transfers';

const CANVAS_W = 1000;
const MIN_ROW = 46;
/** Bezier control-point x positions shared by every ribbon and ghost curve. */
const CTRL_X1 = 420;
const CTRL_X2 = 580;

// -- labels ------------------------------------------------------------------

function routeWeight(route: RouteVolume, mode: FlowMode): number {
  return mode === 'transfers' ? route.transfers : weiToEth(route.valueWei);
}

function weightLabel(value: number, mode: FlowMode): string {
  if (mode === 'transfers') return fmt(value);
  if (value === 0) return '0 ETH';
  if (value < 0.0001) return `${value.toExponential(2)} ETH`;
  return `${value.toFixed(4)} ETH`;
}

function pctLabel(value: number, total: number): string {
  if (total <= 0) return '0.00%';
  return `${((value / total) * 100).toFixed(2)}%`;
}

// -- aggregation -------------------------------------------------------------

interface WeightedRoute {
  route: RouteVolume;
  weight: number;
}

interface SideEntry {
  chain: ChainView;
  value: number;
}

/**
 * Total weight per chain on one side of the chart, heaviest first. Ghost
 * routes contribute zero-value entries so their chains still get a row.
 */
function sideEntries(
  weighted: WeightedRoute[],
  ghosts: RouteVolume[],
  side: 'srcChain' | 'dstChain',
  byId: Map<number, ChainView>,
): SideEntry[] {
  const totals = new Map<number, number>();
  for (const { route, weight } of weighted) {
    totals.set(route[side], (totals.get(route[side]) ?? 0) + weight);
  }
  for (const route of ghosts) {
    if (!totals.has(route[side])) totals.set(route[side], 0);
  }
  return [...totals.entries()]
    .map(([id, value]) => ({ chain: chainView(byId, id), value }))
    .sort((a, b) => b.value - a.value);
}

// -- layout ------------------------------------------------------------------

interface SideNode extends SideEntry {
  y: number;
  h: number;
}

/** Column height: a minimum row for every chain plus spare that layoutSide redistributes. */
function chartHeight(rows: number): number {
  return Math.max(360, rows * MIN_ROW + 138);
}

/**
 * Distribute one column: every row keeps a readable minimum height and the
 * remaining space is split by each chain's share, so dominant chains render
 * as visibly taller cells like the ribbon widths they anchor.
 */
function layoutSide(entries: SideEntry[], height: number): SideNode[] {
  const n = entries.length;
  if (n === 0) return [];
  const sum = entries.reduce((acc, e) => acc + e.value, 0);
  const spare = Math.max(0, height - n * MIN_ROW);
  let y = 0;
  return entries.map((e) => {
    const h = MIN_ROW + (sum > 0 ? (e.value / sum) * spare : spare / n);
    const node = { ...e, y, h };
    y += h;
    return node;
  });
}

interface Ribbon {
  key: string;
  sy0: number;
  sy1: number;
  ty0: number;
  ty1: number;
  share: number;
}

/** Partition each node's height into per-route slots, stacked to minimize crossings. */
function buildRibbons(
  weighted: WeightedRoute[],
  sources: SideNode[],
  targets: SideNode[],
  total: number,
): Ribbon[] {
  const srcIndex = new Map(sources.map((node, idx) => [node.chain.id, idx]));
  const dstIndex = new Map(targets.map((node, idx) => [node.chain.id, idx]));
  const srcOffset = new Map<number, number>();
  const dstOffset = new Map<number, number>();

  const ordered = [...weighted].sort((a, b) => {
    const bySrc = (srcIndex.get(a.route.srcChain) ?? 0) - (srcIndex.get(b.route.srcChain) ?? 0);
    if (bySrc !== 0) return bySrc;
    return (dstIndex.get(a.route.dstChain) ?? 0) - (dstIndex.get(b.route.dstChain) ?? 0);
  });

  const ribbons: Ribbon[] = [];
  for (const { route, weight } of ordered) {
    const src = sources[srcIndex.get(route.srcChain) ?? -1];
    const dst = targets[dstIndex.get(route.dstChain) ?? -1];
    if (!src || !dst || src.value === 0 || dst.value === 0) continue;
    const sh = (weight / src.value) * src.h;
    const th = (weight / dst.value) * dst.h;
    const srcOff = srcOffset.get(route.srcChain) ?? 0;
    const dstOff = dstOffset.get(route.dstChain) ?? 0;
    srcOffset.set(route.srcChain, srcOff + sh);
    dstOffset.set(route.dstChain, dstOff + th);
    const sy0 = src.y + srcOff;
    const ty0 = dst.y + dstOff;
    ribbons.push({
      key: `${route.srcChain}-${route.dstChain}`,
      sy0,
      sy1: sy0 + sh,
      ty0,
      ty1: ty0 + th,
      share: weight / total,
    });
  }
  return ribbons;
}

// -- svg geometry ------------------------------------------------------------

/** Left-to-right bezier from a source-edge y to a target-edge y. */
function curvePath(y0: number, y1: number): string {
  return `M 0 ${y0} C ${CTRL_X1} ${y0}, ${CTRL_X2} ${y1}, ${CANVAS_W} ${y1}`;
}

/** Closed ribbon area between the top and bottom edge curves. */
function ribbonPath(r: Ribbon): string {
  return `${curvePath(r.sy0, r.ty0)} L ${CANVAS_W} ${r.ty1} C ${CTRL_X2} ${r.ty1}, ${CTRL_X1} ${r.sy1}, 0 ${r.sy1} Z`;
}

function ribbonOpacity(share: number): number {
  return Math.max(0.55, Math.min(1, 0.45 + share * 0.6));
}

// -- components --------------------------------------------------------------

function FlowLabels() {
  return (
    <div className="flow-labels">
      <span>Source</span>
      <span />
      <span>Target</span>
    </div>
  );
}

function FlowColumn({
  nodes,
  side,
  height,
  mode,
  total,
  activeId,
  onSelect,
}: {
  nodes: SideNode[];
  side: 'source' | 'target';
  height: number;
  mode: FlowMode;
  total: number;
  activeId?: number;
  onSelect?: (id: number) => void;
}) {
  return (
    <div className={`flow-side ${side}`} style={{ height }}>
      {nodes.map((node) => {
        const style = {
          position: 'absolute' as const,
          top: node.y,
          height: node.h,
          left: 0,
          right: 0,
        };
        const content = (
          <>
            <Glyph chain={node.chain} size={24} />
            <strong>{node.chain.name}</strong>
            <span className="flow-spacer" />
            <span className="mono">{weightLabel(node.value, mode)}</span>
            <span className="flow-pct">{pctLabel(node.value, total)}</span>
          </>
        );

        if (!onSelect) {
          return (
            <div className="flow-node" key={node.chain.id} style={style}>
              {content}
            </div>
          );
        }
        return (
          <button
            type="button"
            key={node.chain.id}
            className={node.chain.id === activeId ? 'flow-node active' : 'flow-node'}
            style={style}
            onClick={() => onSelect(node.chain.id)}
          >
            {content}
          </button>
        );
      })}
    </div>
  );
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
  const [selectedSource, setSelectedSource] = useState<number | null>(null);
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

  if (weighted.length === 0 && ghosts.length === 0) {
    return (
      <div className="flow-card">
        <FlowLabels />
        <EmptyPanel>{empty}</EmptyPanel>
      </div>
    );
  }

  const sourceEntries = sideEntries(weighted, ghosts, 'srcChain', byId);
  const activeSource =
    selectedSource != null && sourceEntries.some((item) => item.chain.id === selectedSource)
      ? selectedSource
      : sourceEntries[0]?.chain.id;
  const activeWeighted = weighted.filter(({ route }) => route.srcChain === activeSource);
  const activeGhosts = ghosts.filter((route) => route.srcChain === activeSource);
  const targetEntries = sideEntries(activeWeighted, activeGhosts, 'dstChain', byId);

  const sourceTotal = Math.max(
    sourceEntries.reduce((sum, item) => sum + item.value, 0),
    Number.EPSILON,
  );
  const activeTotal = Math.max(
    activeWeighted.reduce((sum, item) => sum + item.weight, 0),
    Number.EPSILON,
  );

  const height = chartHeight(Math.max(sourceEntries.length, targetEntries.length, 1));
  const sources = layoutSide(sourceEntries, height);
  const targets = layoutSide(targetEntries, height);
  const ribbons = buildRibbons(activeWeighted, sources, targets, activeTotal);
  const srcById = new Map(sources.map((node) => [node.chain.id, node]));
  const dstById = new Map(targets.map((node) => [node.chain.id, node]));

  return (
    <div className="flow-card">
      <FlowLabels />
      <div className="flow-layout">
        <FlowColumn
          nodes={sources}
          side="source"
          height={height}
          mode={mode}
          total={sourceTotal}
          activeId={activeSource}
          onSelect={setSelectedSource}
        />
        <div className="flow-canvas" style={{ height }}>
          <svg
            viewBox={`0 0 ${CANVAS_W} ${height}`}
            preserveAspectRatio="none"
            width="100%"
            height={height}
          >
            <defs>
              <linearGradient id="flowGrad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="var(--accent)" stopOpacity="0.55" />
                <stop offset="0.55" stopColor="var(--accent-2)" stopOpacity="0.26" />
                <stop offset="1" stopColor="var(--accent-2)" stopOpacity="0.1" />
              </linearGradient>
            </defs>
            {activeGhosts.map((route) => {
              const src = srcById.get(route.srcChain);
              const dst = dstById.get(route.dstChain);
              if (!src || !dst) return null;
              return (
                <path
                  key={`ghost-${route.srcChain}-${route.dstChain}`}
                  d={curvePath(src.y + src.h / 2, dst.y + dst.h / 2)}
                  fill="none"
                  stroke="var(--line-2)"
                  strokeWidth={2}
                  strokeDasharray="6 8"
                  strokeLinecap="round"
                  opacity={0.6}
                />
              );
            })}
            {ribbons.map((ribbon) => (
              <g key={ribbon.key} className="flow-path">
                <path
                  d={ribbonPath(ribbon)}
                  fill="url(#flowGrad)"
                  opacity={ribbonOpacity(ribbon.share)}
                />
                <path
                  d={curvePath(ribbon.sy0, ribbon.ty0)}
                  fill="none"
                  stroke="var(--accent)"
                  strokeOpacity={0.5}
                  strokeWidth={1}
                />
                <path
                  d={curvePath(ribbon.sy1, ribbon.ty1)}
                  fill="none"
                  stroke="var(--accent)"
                  strokeOpacity={0.3}
                  strokeWidth={1}
                />
              </g>
            ))}
          </svg>
          <span className="flow-watermark mono">CROSSSCOUT</span>
        </div>
        <FlowColumn nodes={targets} side="target" height={height} mode={mode} total={activeTotal} />
      </div>
    </div>
  );
}
