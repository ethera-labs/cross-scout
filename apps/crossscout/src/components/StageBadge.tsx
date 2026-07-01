import type { XtStatus } from '@cross-scout/sdk';
import { stageName, statusColor } from '../lib/format';

export function StatusBadge({ status }: { status: XtStatus }) {
  const { fg, bg } = statusColor(status);
  return (
    <span
      className="mono"
      style={{
        fontSize: 11,
        fontWeight: 600,
        padding: '3px 9px',
        borderRadius: 6,
        color: fg,
        background: bg,
        textTransform: 'capitalize',
      }}
    >
      {status}
    </span>
  );
}

/** A 9-segment lifecycle progress pill. */
export function StageMeter({ stage, status }: { stage: number; status: XtStatus }) {
  const { fg } = statusColor(status);
  const done = status === 'failed' ? 0 : stage;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ display: 'flex', gap: 2 }}>
        {Array.from({ length: 9 }, (_, i) => (
          <span
            key={i}
            style={{
              width: 10,
              height: 5,
              borderRadius: 2,
              background: i < done ? fg : 'var(--line-2)',
            }}
          />
        ))}
      </div>
      <span className="mono" style={{ fontSize: 11, color: 'var(--fg-faint)' }}>
        {stageName(stage)}
      </span>
    </div>
  );
}
