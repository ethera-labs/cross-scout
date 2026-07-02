import type { ReactNode } from 'react';
import type { SuperblockStatus, XtStatus } from '@cross-scout/sdk';
import type { ChainView } from '../lib/chains';
import { chainView } from '../lib/chains';
import { statusLabel, statusSoft, statusVar } from '../lib/status';
import { Button } from '../ui/Button';

export function Glyph({ chain, size = 30 }: { chain: ChainView; size?: number }) {
  return (
    <span
      className="glyph"
      style={{
        width: size,
        height: size,
        borderRadius: size <= 20 ? 6 : 8,
        color: chain.color,
        borderColor: chain.color,
        background: `${chain.color}20`,
        fontSize: Math.max(10, size * 0.42),
      }}
    >
      {chain.glyph}
    </span>
  );
}

export function StatusPill({ status, large = false }: { status: XtStatus | SuperblockStatus; large?: boolean }) {
  return (
    <span
      className={large ? 'pill pill-large' : 'pill'}
      style={{ color: statusVar[status], background: statusSoft[status] }}
    >
      <span className="pill-dot" style={{ background: statusVar[status], boxShadow: `0 0 8px ${statusVar[status]}` }} />
      {statusLabel(status)}
    </span>
  );
}

/** Overlapping mini-glyphs for a set of chain ids. */
export function ChainStack({ ids, chains }: { ids: number[]; chains: Map<number, ChainView> }) {
  return (
    <span className="chain-stack">
      {ids.map((id, idx) => {
        const chain = chainView(chains, id);
        return (
          <span
            key={id}
            style={{
              background: `${chain.color}26`,
              color: chain.color,
              borderColor: 'var(--bg-1)',
              marginLeft: idx === 0 ? 0 : -7,
            }}
          >
            {chain.glyph}
          </span>
        );
      })}
    </span>
  );
}

export function DetailMeta({ rows }: { rows: Array<[string, string]> }) {
  return (
    <div className="meta-grid">
      {rows.map(([label, value]) => (
        <div className="meta-cell" key={label}>
          <span className="mono">{label}</span>
          <strong className="mono">{value}</strong>
        </div>
      ))}
    </div>
  );
}

export function PanelHeader({ title, value }: { title: string; value: string }) {
  return (
    <div className="panel-header">
      <h3>{title}</h3>
      <span className="mono">{value}</span>
    </div>
  );
}

export function SectionTitle({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="section-title">
      <h2>{title}</h2>
      {action}
    </div>
  );
}

export function GhostButton({ children, onClick }: { children: string; onClick: () => void }) {
  return (
    <button type="button" className="ghost-button" onClick={onClick}>
      {children}
      <span aria-hidden="true">-&gt;</span>
    </button>
  );
}

export function EmptyPanel({ children }: { children: ReactNode }) {
  return <div className="no-results">{children}</div>;
}

export function BackButton({ children, onClick }: { children: string; onClick: () => void }) {
  return (
    <button type="button" className="back-button" onClick={onClick}>
      &lt;- {children}
    </button>
  );
}

export function FilterBar<T extends string>({
  filters,
  active,
  counts,
  labels,
  onSelect,
}: {
  filters: T[];
  active: T;
  counts: Record<T, number>;
  labels: Record<T, string>;
  onSelect: (filter: T) => void;
}) {
  return (
    <div className="filter-bar">
      {filters.map((filter) => (
        <Button key={filter} active={active === filter} onClick={() => onSelect(filter)}>
          <span
            className="filter-dot"
            style={{
              background:
                filter === 'all' ? 'var(--fg-faint)' : statusVar[filter as XtStatus | SuperblockStatus],
            }}
          />
          {labels[filter]}
          <span className="mono filter-count">{counts[filter]}</span>
        </Button>
      ))}
    </div>
  );
}
