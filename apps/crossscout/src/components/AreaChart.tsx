import { memo, useMemo, useRef, useState } from 'react';
import { EmptyPanel } from './primitives';

export interface AreaPoint {
  ts: string;
  value: number;
}

const WIDTH = 1000;
const HEIGHT = 280;
const PAD_X = 8;
const PAD_TOP = 18;
const PAD_BOTTOM = 34;
const GRID_LINES = [0.25, 0.5, 0.75];
const DAY_FORMATTER = new Intl.DateTimeFormat('en-US', { day: '2-digit', month: 'short' });
const TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function axisTime(iso: string, dayScale: boolean): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return '';
  return (dayScale ? DAY_FORMATTER : TIME_FORMATTER).format(time);
}

/**
 * Time-series area chart drawn with the same hand-rolled SVG approach as
 * FlowChart: no chart dependency, CSS-variable colors, hover guide with a
 * nearest-point readout.
 */
export const AreaChart = memo(function AreaChart({
  points,
  formatValue,
  label,
  empty = 'no activity in the current window',
}: {
  points: AreaPoint[];
  formatValue: (value: number) => string;
  label: string;
  empty?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const geometry = useMemo(() => {
    if (points.length === 0) return null;
    const max = Math.max(...points.map((p) => p.value), Number.EPSILON);
    const innerW = WIDTH - PAD_X * 2;
    const innerH = HEIGHT - PAD_TOP - PAD_BOTTOM;
    const step = points.length > 1 ? innerW / (points.length - 1) : 0;
    const coords = points.map((p, idx) => ({
      x: PAD_X + (points.length > 1 ? idx * step : innerW / 2),
      y: PAD_TOP + innerH * (1 - p.value / max),
    }));
    const first = coords[0];
    const last = coords[coords.length - 1];
    if (!first || !last) return null;
    const line = coords.map((c, idx) => `${idx === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ');
    const floor = HEIGHT - PAD_BOTTOM;
    const area = `${line} L ${last.x.toFixed(1)} ${floor} L ${first.x.toFixed(1)} ${floor} Z`;
    return { coords, line, area, max };
  }, [points]);

  if (!geometry) return <EmptyPanel>{empty}</EmptyPanel>;

  const { coords, line, area, max } = geometry;
  const [head, next] = points;
  const dayScale = head != null && next != null && Date.parse(next.ts) - Date.parse(head.ts) >= 86_400_000;
  const tickEvery = Math.max(1, Math.ceil(points.length / 7));

  const onMove = (event: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * WIDTH;
    let nearest = 0;
    let best = Number.POSITIVE_INFINITY;
    coords.forEach((c, idx) => {
      const d = Math.abs(c.x - x);
      if (d < best) {
        best = d;
        nearest = idx;
      }
    });
    setHover(nearest);
  };

  const hoverPoint = hover != null ? points[hover] : undefined;
  const hoverAt = hover != null ? coords[hover] : undefined;
  const active = hoverPoint && hoverAt ? { point: hoverPoint, at: hoverAt } : null;

  return (
    <div className="area-chart">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        width="100%"
        height={HEIGHT}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label={label}
      >
        <defs>
          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0.35" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {GRID_LINES.map((g) => {
          const y = PAD_TOP + (HEIGHT - PAD_TOP - PAD_BOTTOM) * g;
          return (
            <line
              key={g}
              x1={PAD_X}
              x2={WIDTH - PAD_X}
              y1={y}
              y2={y}
              stroke="var(--line)"
              strokeDasharray="3 7"
              strokeWidth={1}
            />
          );
        })}
        <path d={area} fill="url(#areaGrad)" />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth={2.5} strokeLinejoin="round" />
        {active && (
          <>
            <line
              x1={active.at.x}
              x2={active.at.x}
              y1={PAD_TOP}
              y2={HEIGHT - PAD_BOTTOM}
              stroke="var(--fg-dim)"
              strokeDasharray="2 5"
              strokeWidth={1}
            />
            <circle cx={active.at.x} cy={active.at.y} r={4.5} fill="var(--accent)" stroke="var(--bg-1)" strokeWidth={2} />
          </>
        )}
      </svg>
      <div className="area-axis mono">
        {points.map((p, idx) =>
          idx % tickEvery === 0 ? <span key={p.ts}>{axisTime(p.ts, dayScale)}</span> : null,
        )}
      </div>
      <div className="area-scale mono">
        <span>{formatValue(max)}</span>
        <span>0</span>
      </div>
      {active && (
        <div className="area-tooltip mono" style={{ left: `${(active.at.x / WIDTH) * 100}%` }}>
          <strong>{formatValue(active.point.value)}</strong>
          <span>{axisTime(active.point.ts, dayScale)}</span>
        </div>
      )}
    </div>
  );
});
