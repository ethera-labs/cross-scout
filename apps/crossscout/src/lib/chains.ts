import type { Xt } from '@cross-scout/sdk';
import { chainName } from './format';

/** Display identity of a chain: name, accent color and glyph initial. */
export interface ChainView {
  id: number;
  name: string;
  color: string;
  glyph: string;
  current: boolean;
}

const palette = ['#38E8D0', '#F5B23E', '#46D38A', '#5B8DEF', '#8C7CF0', '#F2709C'];

function chainGlyph(name: string, id: number): string {
  const words = name.replace(/[^a-zA-Z0-9 ]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) return words[words.length - 1]!.slice(0, 1).toUpperCase();
  return (words[0]?.slice(0, 1) ?? String(id).slice(-1)).toUpperCase();
}

export function makeChains(ids: number[], hostChain?: number): ChainView[] {
  return ids.map((id, index) => {
    const name = chainName(id);
    return {
      id,
      name,
      color: palette[index % palette.length]!,
      glyph: chainGlyph(name, id),
      current: hostChain === id,
    };
  });
}

export function chainById(chains: ChainView[]): Map<number, ChainView> {
  return new Map(chains.map((chain) => [chain.id, chain]));
}

/** Resolve a chain id to its view, falling back to a neutral placeholder. */
export function chainView(chains: Map<number, ChainView>, id: number | null | undefined): ChainView {
  if (id != null && chains.has(id)) return chains.get(id)!;
  const name = chainName(id);
  return {
    id: id ?? 0,
    name,
    color: 'var(--fg-faint)',
    glyph: chainGlyph(name, id ?? 0),
    current: false,
  };
}

/** Ordered, deduplicated source → hops → target chain sequence of an XT. */
export function chainSequence(xt: Xt, chains: Map<number, ChainView>): ChainView[] {
  const ids = new Set<number>();
  if (xt.srcChain != null) ids.add(xt.srcChain);
  for (const id of xt.chains) ids.add(id);
  if (xt.dstChain != null) ids.add(xt.dstChain);
  return [...ids].map((id) => chainView(chains, id));
}
