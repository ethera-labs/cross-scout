import type { Xt } from '@cross-scout/sdk';
import { chainName, formatWei, shortHex, timeAgo } from '../lib/format';
import { StageMeter, StatusBadge } from './StageBadge';

const HEAD: React.CSSProperties = {
  fontFamily: "'Geist Mono', monospace",
  fontSize: 10.5,
  letterSpacing: 0.8,
  textTransform: 'uppercase',
  color: 'var(--fg-faint)',
};

const cols = '150px 1fr 150px 1fr 110px 80px';

export function XtTable({
  xts,
  selected,
  onSelect,
}: {
  xts: Xt[];
  selected: string | null;
  onSelect: (hash: string) => void;
}) {
  return (
    <div
      style={{
        border: '1px solid var(--line)',
        borderRadius: 14,
        background: 'var(--bg-1)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: cols,
          gap: 14,
          padding: '12px 18px',
          borderBottom: '1px solid var(--line)',
          background: 'var(--bg-2)',
        }}
      >
        <span style={HEAD}>XT</span>
        <span style={HEAD}>Route</span>
        <span style={HEAD}>Status</span>
        <span style={HEAD}>Lifecycle</span>
        <span style={HEAD}>Value</span>
        <span style={HEAD}>Age</span>
      </div>

      {xts.length === 0 && (
        <div style={{ padding: '28px 18px', color: 'var(--fg-faint)', fontSize: 13 }}>
          waiting for cross-chain transactions…
        </div>
      )}

      {xts.map((xt) => {
        const active = xt.xtHash === selected;
        return (
          <div
            key={xt.xtHash}
            onClick={() => onSelect(xt.xtHash)}
            style={{
              display: 'grid',
              gridTemplateColumns: cols,
              gap: 14,
              padding: '13px 18px',
              borderBottom: '1px solid var(--line)',
              alignItems: 'center',
              cursor: 'pointer',
              background: active ? 'var(--accent-soft)' : 'transparent',
            }}
          >
            <span className="mono" style={{ fontSize: 12.5, color: 'var(--accent)' }}>
              {shortHex(xt.xtHash)}
            </span>
            <span style={{ fontSize: 13, color: 'var(--fg)' }}>
              {chainName(xt.srcChain)}{' '}
              <span style={{ color: 'var(--fg-faint)' }}>→</span> {chainName(xt.dstChain)}
            </span>
            <StatusBadge status={xt.status} />
            <StageMeter stage={xt.stage} status={xt.status} />
            <span className="mono" style={{ fontSize: 12.5, color: 'var(--fg-dim)' }}>
              {formatWei(xt.valueWei)}
            </span>
            <span className="mono" style={{ fontSize: 11.5, color: 'var(--fg-faint)' }}>
              {timeAgo(xt.updatedAt)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
