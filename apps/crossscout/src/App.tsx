import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { Button } from './ui/Button';

type Theme = 'dark' | 'light';
type Network = 'Mainnet' | 'Testnet';
type Status = 'pending' | 'unsafe' | 'validated' | 'finalized' | 'failed';
type SuperblockStatus = 'proposed' | 'validated' | 'finalized';
type Decision = 'pending' | 'commit' | 'abort';

type Route =
  | { name: 'overview' }
  | { name: 'txs' }
  | { name: 'txDetail'; id: string }
  | { name: 'superblocks' }
  | { name: 'superblockDetail'; number: number }
  | { name: 'instances' }
  | { name: 'instanceDetail'; id: string }
  | { name: 'mailbox' }
  | { name: 'rollups' }
  | { name: 'rollupDetail'; key: string };

interface Chain {
  key: string;
  name: string;
  chainId: number;
  color: string;
  glyph: string;
  blockTime: string;
  current?: boolean;
}

interface Vote {
  chain: Chain;
  vote: boolean;
  ms: number;
}

interface MailboxMessage {
  id: string;
  from: Chain;
  to: Chain;
  label: string;
  session: string;
  data: string;
  direction: 'in' | 'out';
  superblock: number;
  ts: number;
}

interface BlockState {
  chain: Chain;
  l2Block: number;
  preRoot: string;
  postRoot: string;
  configHash: string;
}

interface Tx {
  id: string;
  periodId: number;
  sequence: number;
  src: Chain;
  dst: Chain;
  chains: Chain[];
  status: Status;
  stage: number;
  superblock: number | null;
  txCount: number;
  msgCount: number;
  value: number;
  sender: string;
  ts: number;
  votes: Vote[];
  decision: Decision;
  mailbox: MailboxMessage[];
  blocks: BlockState[];
}

interface Superblock {
  number: number;
  hash: string;
  parentHash: string;
  period: number;
  status: SuperblockStatus;
  mailboxRoot: string;
  xtCount: number;
  proveTime: number;
  l1Tx: string | null;
  l1Block: number | null;
  ts: number;
  chains: BlockState[];
}

interface MailboxCounterparty {
  chain: Chain;
  inboxRoot: string;
  outboxRoot: string;
  inCount: number;
  outCount: number;
  messages: MailboxMessage[];
}

const CHAINS: Chain[] = [
  { key: 'ethera', name: 'Ethera', chainId: 42801, color: '#38E8D0', glyph: 'E', blockTime: '0.2s', current: true },
  { key: 'solara', name: 'Solara', chainId: 42802, color: '#F5B23E', glyph: 'S', blockTime: '1.0s' },
  { key: 'verde', name: 'Verde', chainId: 42803, color: '#46D38A', glyph: 'V', blockTime: '2.0s' },
  { key: 'cobalt', name: 'Cobalt', chainId: 42804, color: '#5B8DEF', glyph: 'C', blockTime: '0.5s' },
  { key: 'marlin', name: 'Marlin', chainId: 42805, color: '#8C7CF0', glyph: 'M', blockTime: '1.0s' },
  { key: 'pyra', name: 'Pyra', chainId: 42806, color: '#F2709C', glyph: 'P', blockTime: '2.0s' },
];

const HOST = CHAINS[0]!;
const COUNTERPARTIES = CHAINS.filter((chain) => !chain.current);
const CHAIN_BY_KEY = Object.fromEntries(CHAINS.map((chain) => [chain.key, chain]));
const STATUSES: Status[] = ['pending', 'unsafe', 'validated', 'finalized', 'failed'];
const SUPERBLOCK_STATUSES: SuperblockStatus[] = ['proposed', 'validated', 'finalized'];
const STAGE_NAMES = [
  'requested',
  'scheduled',
  'simulating',
  'voting',
  'decided',
  'included',
  'settled',
  'validated',
  'finalized',
];

const STATUS_LABEL: Record<Status, string> = {
  pending: 'In-flight',
  unsafe: 'Unsafe',
  validated: 'Validated',
  finalized: 'Finalized',
  failed: 'Rolled back',
};

const SUPERBLOCK_STATUS_LABEL: Record<SuperblockStatus, string> = {
  proposed: 'Proposed',
  validated: 'Validated',
  finalized: 'Finalized',
};

const STATUS_VAR: Record<Status | SuperblockStatus, string> = {
  pending: 'var(--accent)',
  unsafe: 'var(--warn)',
  proposed: 'var(--warn)',
  validated: 'var(--info)',
  finalized: 'var(--ok)',
  failed: 'var(--bad)',
};

const STATUS_SOFT: Record<Status | SuperblockStatus, string> = {
  pending: 'var(--accent-soft)',
  unsafe: 'var(--warn-soft)',
  proposed: 'var(--warn-soft)',
  validated: 'var(--info-soft)',
  finalized: 'var(--ok-soft)',
  failed: 'var(--bad-soft)',
};

const formatter = new Intl.NumberFormat('en-US');

function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, list: T[]): T {
  return list[Math.floor(rng() * list.length)] ?? list[0]!;
}

function hex(rng: () => number, n: number): string {
  const chars = '0123456789abcdef';
  let value = '0x';
  for (let i = 0; i < n; i += 1) value += chars[Math.floor(rng() * 16)] ?? '0';
  return value;
}

function short(value: string | null | undefined, lead = 6, tail = 4): string {
  if (!value) return '-';
  if (value.length <= lead + tail + 2) return value;
  return `${value.slice(0, lead + 2)}...${value.slice(-tail)}`;
}

function fmt(n: number): string {
  return formatter.format(Math.round(n));
}

function formatUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${fmt(n)}`;
}

function timeAgo(ts: number, now = Date.now()): string {
  const secs = Math.max(0, Math.floor((now - ts) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function clock(ts: number): string {
  const d = new Date(ts);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
}

function instanceId(tx: Tx): string {
  return `0x${tx.id.slice(6, 10)}...${tx.id.slice(-8)}`;
}

function routeToKey(route: Route): string {
  return route.name;
}

function navTo(route: Route, setRoute: (r: Route) => void): void {
  setRoute(route);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function buildMockTxs(now: number): Tx[] {
  const rng = makeRng(20240617);
  const out: Tx[] = [];
  const labels = ['transferRemote', 'settleOrder', 'mintRemote', 'callRemote', 'releaseLock', 'ackReceipt', 'bridgeAsset'];

  for (let i = 0; i < 64; i += 1) {
    const age = Math.floor(i ** 1.45 * 12 + rng() * 42) + 3;
    const ts = now - age * 1000;
    let status: Status = i < 3 ? 'pending' : i < 7 ? 'unsafe' : i < 15 ? 'validated' : 'finalized';
    if (i > 16 && rng() < 0.07) status = 'failed';

    const a = pick(rng, COUNTERPARTIES);
    let b = pick(rng, COUNTERPARTIES);
    if (b.key === a.key) b = COUNTERPARTIES.find((chain) => chain.key !== a.key) ?? b;
    const tri = rng() < 0.18;
    const src = rng() < 0.5 ? HOST : a;
    const dst = src.key === HOST.key ? a : HOST;
    const chains = tri ? [HOST, a, b] : [HOST, a];
    const id = hex(rng, 64);
    const decision: Decision = status === 'failed' ? 'abort' : 'commit';
    const msgCount = 1 + Math.floor(rng() * 6) + (tri ? 2 : 0);
    const votes: Vote[] = chains.map((chain, idx) => ({
      chain,
      vote: status !== 'failed' || idx !== 1,
      ms: ts + 600 + idx * 220,
    }));
    const mailbox: MailboxMessage[] = Array.from({ length: Math.min(msgCount, 4) }, (_, idx) => {
      const from = idx % 2 === 0 ? src : dst;
      const to = idx % 2 === 0 ? dst : src;
      return {
        id: `${id}-${idx}`,
        from,
        to,
        label: pick(rng, labels),
        session: hex(rng, 16),
        data: hex(rng, 32),
        direction: from.key === HOST.key ? 'out' : 'in',
        superblock: 18470 - Math.floor(i / 5),
        ts: ts + idx * 500,
      };
    });
    const blocks: BlockState[] = chains.map((chain, idx) => ({
      chain,
      l2Block: 4_200_000 + i * 13 + idx * 3,
      preRoot: hex(rng, 32),
      postRoot: hex(rng, 32),
      configHash: hex(rng, 32),
    }));

    out.push({
      id,
      periodId: 1043 - Math.floor(i / 18),
      sequence: 70 - i,
      src,
      dst,
      chains,
      status,
      stage: status === 'pending' ? 2 + (i % 4) : status === 'unsafe' ? 7 : status === 'validated' ? 8 : status === 'finalized' ? 9 : 5,
      superblock: status === 'pending' ? null : 18470 - Math.floor(i / 5),
      txCount: 1 + Math.floor(rng() * 5),
      msgCount,
      value: rng() < 0.16 ? 0 : 8_000 + Math.floor(rng() * 420_000),
      sender: hex(rng, 40),
      ts,
      votes,
      decision,
      mailbox,
      blocks,
    });
  }

  return out;
}

function buildSuperblocks(now: number): Superblock[] {
  const rng = makeRng(7042026);
  return Array.from({ length: 18 }, (_, idx) => {
    const status = idx < 2 ? 'proposed' : idx < 7 ? 'validated' : 'finalized';
    const chains = [HOST, ...COUNTERPARTIES.slice(idx % 2, idx % 2 + 3)].map((chain, j) => ({
      chain,
      l2Block: 4_110_200 + idx * 52 + j * 9,
      preRoot: hex(rng, 32),
      postRoot: hex(rng, 32),
      configHash: hex(rng, 32),
    }));
    return {
      number: 18470 - idx,
      hash: hex(rng, 32),
      parentHash: hex(rng, 32),
      period: 1043 - Math.floor(idx / 4),
      status,
      mailboxRoot: hex(rng, 32),
      xtCount: 23 + Math.floor(rng() * 82),
      proveTime: 42 + Math.floor(rng() * 210),
      l1Tx: status === 'finalized' ? hex(rng, 32) : null,
      l1Block: status === 'finalized' ? 20_300_000 + idx * 6 : null,
      ts: now - (idx * 185 + 55) * 1000,
      chains,
    };
  });
}

function buildMailboxes(txs: Tx[]): MailboxCounterparty[] {
  const rng = makeRng(98765);
  return COUNTERPARTIES.map((chain) => {
    const messages = txs
      .flatMap((tx) => tx.mailbox)
      .filter((msg) => msg.from.key === chain.key || msg.to.key === chain.key)
      .slice(0, 9);
    const inCount = 140 + Math.floor(rng() * 900);
    const outCount = 120 + Math.floor(rng() * 840);
    return {
      chain,
      inboxRoot: hex(rng, 32),
      outboxRoot: hex(rng, 32),
      inCount,
      outCount,
      messages,
    };
  });
}

function makeLiveTx(seed: number): Tx {
  const now = Date.now();
  const rng = makeRng(seed);
  const counterparty = pick(rng, COUNTERPARTIES);
  const src = rng() < 0.5 ? HOST : counterparty;
  const dst = src.key === HOST.key ? counterparty : HOST;
  const id = hex(rng, 64);
  const votes = [HOST, counterparty].map((chain, idx) => ({ chain, vote: true, ms: now + idx * 160 }));
  const mailbox = [0, 1].map((idx) => {
    const from = idx % 2 === 0 ? src : dst;
    const to = idx % 2 === 0 ? dst : src;
    return {
      id: `${id}-live-${idx}`,
      from,
      to,
      label: idx === 0 ? 'transferRemote' : 'ackReceipt',
      session: hex(rng, 16),
      data: hex(rng, 32),
      direction: from.key === HOST.key ? 'out' : 'in',
      superblock: 18470,
      ts: now + idx * 300,
    } satisfies MailboxMessage;
  });
  return {
    id,
    periodId: 1043,
    sequence: Math.floor(rng() * 100),
    src,
    dst,
    chains: [HOST, counterparty],
    status: 'pending',
    stage: 3,
    superblock: null,
    txCount: 1 + Math.floor(rng() * 4),
    msgCount: 2 + Math.floor(rng() * 4),
    value: 15_000 + Math.floor(rng() * 160_000),
    sender: hex(rng, 40),
    ts: now,
    votes,
    decision: 'commit',
    mailbox,
    blocks: [HOST, counterparty].map((chain, idx) => ({
      chain,
      l2Block: 4_290_000 + idx,
      preRoot: hex(rng, 32),
      postRoot: hex(rng, 32),
      configHash: hex(rng, 32),
    })),
  };
}

function Glyph({ chain, size = 26 }: { chain: Chain; size?: number }) {
  return (
    <span
      className="glyph"
      style={{
        width: size,
        height: size,
        borderRadius: Math.max(6, Math.floor(size / 4)),
        background: `${chain.color}26`,
        borderColor: `${chain.color}66`,
        color: chain.color,
        fontSize: Math.max(9, Math.floor(size * 0.42)),
      }}
    >
      {chain.glyph}
    </span>
  );
}

function StatusPill({ status, large = false }: { status: Status | SuperblockStatus; large?: boolean }) {
  const label =
    status in STATUS_LABEL
      ? STATUS_LABEL[status as Status]
      : SUPERBLOCK_STATUS_LABEL[status as SuperblockStatus] ?? status;
  return (
    <span
      className={large ? 'pill pill-large' : 'pill'}
      style={{ color: STATUS_VAR[status], background: STATUS_SOFT[status] }}
    >
      <span className="pill-dot" style={{ background: STATUS_VAR[status], boxShadow: `0 0 8px ${STATUS_VAR[status]}` }} />
      {label}
    </span>
  );
}

function LogoIcon() {
  return (
    <svg className="cs-logo-mark" width="36" height="36" viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <rect x="3.25" y="3.25" width="33.5" height="33.5" rx="12" fill="var(--accent-soft)" stroke="var(--line-2)" strokeWidth="1.5" />
      <path d="M11.1 22.7C15.6 14.8 24 15 29.2 8.8" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" />
      <path d="M11.1 17.3C15.6 25.2 24 25 29.2 31.2" stroke="var(--accent-2)" strokeWidth="3" strokeLinecap="round" opacity="0.82" />
      <circle cx="11.5" cy="20" r="4.2" fill="var(--bg-1)" stroke="var(--accent)" strokeWidth="1.9" />
      <circle cx="29.2" cy="8.8" r="3.2" fill="var(--accent)" />
      <circle cx="29.2" cy="31.2" r="3.2" fill="var(--accent-2)" />
      <circle cx="20" cy="20" r="2.2" fill="var(--fg)" opacity="0.9" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2.4" stroke="currentColor" strokeWidth="1.7" />
      <path d="M5 15V5a2 2 0 0 1 2-2h8" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4.2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M20 14.5A8 8 0 1 1 9.5 4 6.3 6.3 0 0 0 20 14.5z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Attribute filter dropdowns ("Protocol", "Source chain", …). Deliberately
// distinct from the solid status toggles beside them - dashed and recessive,
// same height, with a chevron that lights magenta on hover.
function QueryPills({ items }: { items: string[] }) {
  return (
    <div className="query-pills">
      {items.map((item) => (
        <Button key={item} variant="facet" size="md" className="group">
          {item}
          <span className="text-cs-faint transition-colors duration-150 group-hover:text-cs-accent-2">
            <ChevronDownIcon />
          </span>
        </Button>
      ))}
    </div>
  );
}

function SectionTitle({ title, action }: { title: string; action?: JSX.Element }) {
  return (
    <div className="section-title">
      <h2>{title}</h2>
      {action}
    </div>
  );
}

function GhostButton({ children, onClick }: { children: string; onClick: () => void }) {
  return (
    <button type="button" className="ghost-button" onClick={onClick}>
      {children}
      <span aria-hidden="true">-&gt;</span>
    </button>
  );
}

function TxRow({ tx, now, onClick }: { tx: Tx; now: number; onClick: () => void }) {
  return (
    <button type="button" className="tx-row" onClick={onClick}>
      <div className="tx-route">
        <Glyph chain={tx.src} />
        <span className="route-line" />
        <Glyph chain={tx.dst} />
        <div className="route-copy">
          <strong>{tx.src.name} to {tx.dst.name}</strong>
          <span className="mono">{short(tx.id, 8, 5)}</span>
        </div>
      </div>
      <div className="tx-cell">
        <span className="mono">{instanceId(tx)}</span>
        <small className="mono">P{tx.periodId} / seq {tx.sequence}</small>
      </div>
      <div className="tx-cell">
        <span>{tx.txCount} txs</span>
        <small>{tx.msgCount} mailbox msgs</small>
      </div>
      <div className="tx-cell">
        <span>{tx.superblock ? `#${tx.superblock}` : 'pending'}</span>
        <small>{timeAgo(tx.ts, now)}</small>
      </div>
      <div className="tx-status">
        <StatusPill status={tx.status} />
      </div>
    </button>
  );
}

function protocolForTx(tx: Tx): string {
  if (tx.chains.length > 2) return 'Multi-hop XT';
  if (tx.msgCount > 4) return 'Mailbox sync';
  if (tx.value > 180_000) return 'Remote transfer';
  if (tx.decision === 'abort') return '2PC rollback';
  return 'SBCP';
}

function TxTableRow({ tx, now, onClick }: { tx: Tx; now: number; onClick: () => void }) {
  return (
    <button type="button" className="tx-table-row" onClick={onClick}>
      <span className="mono tx-time">{timeAgo(tx.ts, now)}</span>
      <span className="tx-hash-cell">
        <strong className="mono">{short(tx.id, 6, 6)}</strong>
        <CopyIcon />
      </span>
      <span className="tx-address-cell">
        <Glyph chain={tx.src} size={18} />
        <span>
          <strong className="mono">{short(tx.sender, 6, 5)}</strong>
          <small>{tx.value ? `${formatUsd(tx.value * 9)} value` : `${tx.msgCount} mailbox msgs`}</small>
        </span>
      </span>
      <span className="tx-direction" aria-hidden="true">
        -&gt;
      </span>
      <span className="tx-address-cell">
        <Glyph chain={tx.dst} size={18} />
        <span>
          <strong className="mono">{tx.dst.name}</strong>
          <small>{tx.superblock ? `superblock #${tx.superblock}` : 'awaiting settlement'}</small>
        </span>
      </span>
      <span className="tx-protocol-cell">
        <strong>{protocolForTx(tx)}</strong>
        <small className="mono">{instanceId(tx)}</small>
      </span>
      <span className="tx-status-cell">
        <StatusPill status={tx.status} />
      </span>
    </button>
  );
}

function StatGrid({ txs }: { txs: Tx[] }) {
  const total = 18_437 + txs.length;
  const inflight = txs.filter((tx) => tx.status === 'pending').length;
  const messages = 41_208 + txs.reduce((sum, tx) => sum + tx.msgCount, 0);
  const volume = txs.reduce((sum, tx) => sum + tx.value, 0) * 9;
  const stats = [
    ['Total XTs', fmt(total)],
    ['24h XTs', fmt(3_284 + inflight)],
    ['Mailbox Messages', fmt(messages)],
    ['24h Volume', formatUsd(volume)],
  ];
  return (
    <div className="stats-grid">
      {stats.map(([label, value]) => (
        <div className="stat-cell" key={label}>
          <span className="stat-label mono">{label}</span>
          <strong className="stat-value mono">
            {value}
            <CopyIcon />
          </strong>
        </div>
      ))}
    </div>
  );
}

function FlowChart({ txs }: { txs: Tx[] }) {
  const sources = CHAINS.map((chain) => ({
    chain,
    value: txs.filter((tx) => tx.src.key === chain.key).length,
  })).filter((item) => item.value > 0);
  const targets = CHAINS.map((chain) => ({
    chain,
    value: txs.filter((tx) => tx.dst.key === chain.key).length,
  })).filter((item) => item.value > 0);
  const maxRows = Math.max(sources.length, targets.length, 1);
  const height = Math.max(260, maxRows * 54 + 22);
  const total = Math.max(1, txs.length);
  const sourceIndex = new Map(sources.map((item, idx) => [item.chain.key, idx]));
  const targetIndex = new Map(targets.map((item, idx) => [item.chain.key, idx]));
  const pairCounts = new Map<string, { src: Chain; dst: Chain; count: number }>();
  txs.forEach((tx) => {
    const key = `${tx.src.key}:${tx.dst.key}`;
    const current = pairCounts.get(key) ?? { src: tx.src, dst: tx.dst, count: 0 };
    current.count += 1;
    pairCounts.set(key, current);
  });

  const nodeRow = (item: { chain: Chain; value: number }, side: 'source' | 'target') => {
    const pct = Math.round((item.value / total) * 100);
    return (
      <div className="flow-node" key={`${side}-${item.chain.key}`}>
        <Glyph chain={item.chain} />
        <strong>{item.chain.name}</strong>
        <span className="flow-spacer" />
        <span className="mono">{item.value}</span>
        <span className="flow-pct">{pct}%</span>
      </div>
    );
  };

  return (
    <div className="flow-card">
      <div className="flow-labels">
        <span>Source</span>
        <span>Target</span>
      </div>
      <div className="flow-layout" style={{ minHeight: height }}>
        <div className="flow-side">{sources.map((item) => nodeRow(item, 'source'))}</div>
        <div className="flow-canvas">
          <svg viewBox={`0 0 1000 ${height}`} preserveAspectRatio="none" width="100%" height={height}>
            <defs>
              <linearGradient id="flowGrad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="var(--accent)" />
                <stop offset="1" stopColor="var(--accent-2)" />
              </linearGradient>
            </defs>
            {Array.from(pairCounts.values()).map((pair, idx) => {
              const sIdx = sourceIndex.get(pair.src.key) ?? 0;
              const tIdx = targetIndex.get(pair.dst.key) ?? 0;
              const sy = 30 + sIdx * 54;
              const ty = 30 + tIdx * 54;
              const width = Math.max(5, Math.min(34, 4 + pair.count * 1.8));
              const opacity = Math.max(0.16, Math.min(0.75, pair.count / 12));
              return (
                <path
                  key={`${pair.src.key}-${pair.dst.key}`}
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
        <div className="flow-side">{targets.map((item) => nodeRow(item, 'target'))}</div>
      </div>
    </div>
  );
}

function FilterBar<T extends string>({
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
        <Button
          key={filter}
          active={active === filter}
          onClick={() => onSelect(filter)}
        >
          <span className="filter-dot" style={{ background: filter === 'all' ? 'var(--fg-faint)' : STATUS_VAR[filter as Status] }} />
          {labels[filter]}
          <span className="mono filter-count">{counts[filter]}</span>
        </Button>
      ))}
    </div>
  );
}

function OverviewPage({
  txs,
  now,
  network,
  onTxs,
  onTx,
}: {
  txs: Tx[];
  now: number;
  network: Network;
  onTxs: () => void;
  onTx: (tx: Tx) => void;
}) {
  return (
    <div className="overview-page">
      <div className="overview-head">
        <div className="section-title inline">
          <h2>Network Stats</h2>
        </div>
        <div className="overview-actions">
          <Button variant="subtle" size="sm">
            Visit Ethera <span aria-hidden="true">-&gt;</span>
          </Button>
          <Button variant="subtle" size="sm">
            Columns
          </Button>
          <div className="live-pill mono">
            <span />
            LIVE - {network} - P1043
          </div>
        </div>
      </div>
      <StatGrid txs={txs} />

      <SectionTitle title="Cross-Chain Activity" action={<GhostButton onClick={onTxs}>View all</GhostButton>} />
      <div className="activity-toolbar">
        <div className="tabs">
          <span className="tab active">Volume</span>
          <span className="tab">Transfers</span>
        </div>
        <div className="toolbar-actions">
          <span>Last 24 hours</span>
          <span>Download</span>
        </div>
      </div>
      <FlowChart txs={txs} />

      <SectionTitle title="Latest Cross-Chain Transactions" action={<GhostButton onClick={onTxs}>View all</GhostButton>} />
      <div className="tx-feed">
        {txs.slice(0, 7).map((tx) => (
          <TxRow key={tx.id} tx={tx} now={now} onClick={() => onTx(tx)} />
        ))}
      </div>
    </div>
  );
}

function TransactionsPage({
  txs,
  now,
  filter,
  setFilter,
  onTx,
}: {
  txs: Tx[];
  now: number;
  filter: Status | 'all';
  setFilter: (filter: Status | 'all') => void;
  onTx: (tx: Tx) => void;
}) {
  const counts = useMemo(() => {
    const base: Record<Status | 'all', number> = { all: txs.length, pending: 0, unsafe: 0, validated: 0, finalized: 0, failed: 0 };
    txs.forEach((tx) => {
      base[tx.status] += 1;
    });
    return base;
  }, [txs]);
  const rows = filter === 'all' ? txs : txs.filter((tx) => tx.status === filter);
  const labels: Record<Status | 'all', string> = { all: 'All', ...STATUS_LABEL };

  return (
    <>
      <div className="transactions-titlebar">
        <h2>Transactions</h2>
        <span className="live-mode mono">
          <i />
          LIVE MODE
          <b />
        </span>
      </div>
      <div className="page-toolbar">
        <div className="tx-toolbar-left">
          <FilterBar
            filters={['all', ...STATUSES]}
            active={filter}
            counts={counts}
            labels={labels}
            onSelect={setFilter}
          />
          <QueryPills items={['Protocol', 'Source chain', 'Target chain', 'Time']} />
        </div>
        <span className="mono result-count">{rows.length} results</span>
      </div>
      <div className="table-head tx-head dense">
        <span>Time</span>
        <span>Source Tx Hash</span>
        <span>From</span>
        <span />
        <span>To</span>
        <span>Protocol</span>
        <span>Status</span>
      </div>
      <div className="tx-dense-list">
        {rows.map((tx) => (
          <TxTableRow key={tx.id} tx={tx} now={now} onClick={() => onTx(tx)} />
        ))}
      </div>
      <Pager />
    </>
  );
}

function Timeline({ tx }: { tx: Tx }) {
  const completed = tx.status === 'failed' ? Math.min(tx.stage, 5) : tx.stage;
  return (
    <div className="timeline">
      {STAGE_NAMES.map((name, idx) => {
        const step = idx + 1;
        const failed = tx.status === 'failed' && step === completed;
        const done = step < completed || (step === completed && tx.status === 'finalized');
        const current = step === completed && tx.status !== 'finalized' && !failed;
        const stateClass = failed ? 'failed' : done ? 'done' : current ? 'current' : 'upcoming';
        return (
          <div className="timeline-step" key={name}>
            <span className={`timeline-rail ${idx === STAGE_NAMES.length - 1 ? 'last' : ''}`} />
            <span className={`timeline-dot ${stateClass}`} />
            <div>
              <div className="timeline-title">
                <strong>{name}</strong>
                {stateClass !== 'upcoming' && <span className={`timeline-tag ${stateClass}`}>{failed ? 'FAILED' : current ? 'ACTIVE' : 'DONE'}</span>}
              </div>
              <p>{timelineCopy(name)}</p>
              <small className="mono">{stateClass === 'upcoming' ? '-' : clock(tx.ts + idx * 1400)}</small>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function timelineCopy(stage: string): string {
  switch (stage) {
    case 'requested':
      return 'XTRequest accepted by the host rollup.';
    case 'scheduled':
      return 'Shared Publisher assigned the period and instance sequence.';
    case 'simulating':
      return 'Participating sequencers exchanged mailbox reads.';
    case 'voting':
      return '2PC votes collected from participating sequencers.';
    case 'decided':
      return 'Shared Publisher broadcast the commit decision.';
    case 'included':
      return 'Writes sealed into the participating L2 blocks.';
    case 'settled':
      return 'Block range tagged into the superblock batch.';
    case 'validated':
      return 'Aggregated proof validated for the superblock.';
    default:
      return 'Final state anchored on L1 settlement.';
  }
}

function DetailMeta({ rows }: { rows: Array<[string, string]> }) {
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

function TxDetailPage({ tx, now, back }: { tx: Tx; now: number; back: () => void }) {
  return (
    <>
      <button type="button" className="back-button" onClick={back}>
        &lt;- Transactions
      </button>
      <div className="detail-tabs">
        <Button variant="subtle" size="sm" active>
          Overview
        </Button>
        <Button variant="subtle" size="sm">Advanced</Button>
        <Button variant="subtle" size="sm">Progress</Button>
      </div>
      <div className="detail-hero">
        <div className="detail-hero-top">
          <div className="hero-status">
            <StatusPill status={tx.status} large />
            <span className="mono muted">{timeAgo(tx.ts, now)} - {clock(tx.ts)}</span>
          </div>
          <div className="hash-chip">
            <span className="mono">XT Hash</span>
            <strong className="mono">{short(tx.id, 8, 5)}</strong>
            <CopyIcon />
          </div>
        </div>
        <div className="route-diagram">
          {tx.chains.map((chain, idx) => (
            <div className="route-diagram-item" key={chain.key}>
              <div className="route-node" style={{ color: chain.color, borderColor: chain.color, background: `${chain.color}1f`, boxShadow: `0 0 30px ${chain.color}55` }}>
                {chain.glyph}
              </div>
              <strong>{chain.name}</strong>
              <span>{idx === 0 ? 'source' : idx === tx.chains.length - 1 ? 'target' : 'hop'}</span>
              {idx < tx.chains.length - 1 && <i />}
            </div>
          ))}
        </div>
        <DetailMeta
          rows={[
            ['Instance ID', instanceId(tx)],
            ['Period', `P${tx.periodId}`],
            ['Sequence', String(tx.sequence)],
            ['Sender', short(tx.sender, 8, 5)],
            ['Value', tx.value ? formatUsd(tx.value * 9) : '-'],
            ['Superblock', tx.superblock ? `#${tx.superblock}` : 'pending'],
          ]}
        />
      </div>
      <div className="two-col">
        <section className="panel">
          <h3>Lifecycle</h3>
          <Timeline tx={tx} />
        </section>
        <div className="stack">
          <section className="panel">
            <PanelHeader title="2PC Votes" value={`${tx.votes.filter((vote) => vote.vote).length}/${tx.votes.length} commit`} />
            <div className="mini-list">
              {tx.votes.map((vote) => (
                <div className="mini-row" key={vote.chain.key}>
                  <Glyph chain={vote.chain} />
                  <strong>{vote.chain.name}</strong>
                  <span className="mono muted">{clock(vote.ms)}</span>
                  <span className={vote.vote ? 'decision commit' : 'decision abort'}>{vote.vote ? 'COMMIT' : 'ABORT'}</span>
                </div>
              ))}
            </div>
          </section>
          <section className="panel">
            <h3>Block State</h3>
            <div className="mini-list">
              {tx.blocks.map((block) => (
                <div className="block-row" key={block.chain.key}>
                  <div>
                    <Glyph chain={block.chain} size={22} />
                    <strong>{block.chain.name}</strong>
                    <span className="mono">L2 #{fmt(block.l2Block)}</span>
                  </div>
                  <small className="mono">{short(block.preRoot)} -&gt; {short(block.postRoot)}</small>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
      <section className="panel panel-spaced">
        <h3>Mailbox Messages</h3>
        <div className="message-list">
          {tx.mailbox.map((msg) => (
            <MessageRow key={msg.id} msg={msg} now={now} />
          ))}
        </div>
      </section>
    </>
  );
}

function PanelHeader({ title, value }: { title: string; value: string }) {
  return (
    <div className="panel-header">
      <h3>{title}</h3>
      <span className="mono">{value}</span>
    </div>
  );
}

function ChainStack({ chains }: { chains: Chain[] }) {
  return (
    <span className="chain-stack">
      {chains.map((chain, idx) => (
        <span
          key={chain.key}
          style={{
            background: `${chain.color}26`,
            color: chain.color,
            borderColor: 'var(--bg-1)',
            marginLeft: idx === 0 ? 0 : -7,
          }}
        >
          {chain.glyph}
        </span>
      ))}
    </span>
  );
}

function Pager() {
  const cell = 'h-8 min-w-8 px-2';
  return (
    <div className="pager mono">
      <Button size="sm" className={cell} aria-label="Previous page">
        &lt;
      </Button>
      <Button size="sm" className={cell} active aria-label="Page 1">
        1
      </Button>
      <Button size="sm" className={cell}>2</Button>
      <Button size="sm" className={cell}>3</Button>
      <Button size="sm" className={cell}>4</Button>
      <Button size="sm" className={cell} aria-label="Next page">
        &gt;
      </Button>
    </div>
  );
}

function SuperblockTableRow({ sb, now, onClick }: { sb: Superblock; now: number; onClick: () => void }) {
  return (
    <button type="button" className="dense-table-row sb-table-row" onClick={onClick}>
      <span className="tx-hash-cell">
        <strong className="mono">#{sb.number}</strong>
        <CopyIcon />
        <small className="mono">{short(sb.hash)}</small>
      </span>
      <span className="tx-status-cell">
        <StatusPill status={sb.status} />
      </span>
      <span className="mono tx-time">P{sb.period}</span>
      <ChainStack chains={sb.chains.map((chain) => chain.chain)} />
      <span className="tx-protocol-cell">
        <strong>{sb.xtCount} XTs</strong>
        <small className="mono">{Math.floor(sb.proveTime / 60)}m {String(sb.proveTime % 60).padStart(2, '0')}s prove</small>
      </span>
      <span className="tx-hash-cell">
        <strong className="mono">{short(sb.mailboxRoot, 8, 6)}</strong>
        <CopyIcon />
      </span>
      <span className="mono tx-time right">{timeAgo(sb.ts, now)}</span>
    </button>
  );
}

function InstanceTableRow({ tx, now, onClick }: { tx: Tx; now: number; onClick: () => void }) {
  const commits = tx.votes.filter((vote) => vote.vote).length;
  return (
    <button type="button" className="dense-table-row inst-table-row" onClick={onClick}>
      <span className="instance-id">
        <span style={{ background: STATUS_VAR[tx.status], boxShadow: `0 0 7px ${STATUS_VAR[tx.status]}` }} />
        <strong className="mono">{instanceId(tx)}</strong>
      </span>
      <span className="tx-protocol-cell">
        <strong className="mono">P{tx.periodId} / seq {tx.sequence}</strong>
        <small>{short(tx.id, 6, 5)}</small>
      </span>
      <ChainStack chains={tx.chains} />
      <span className="tx-protocol-cell">
        <strong>{commits}/{tx.votes.length}</strong>
        <small>{tx.status === 'pending' ? 'collecting votes' : 'votes sealed'}</small>
      </span>
      <span className={tx.decision === 'commit' ? 'decision commit' : 'decision abort'}>{tx.decision.toUpperCase()}</span>
      <span className="tx-protocol-cell">
        <strong>{protocolForTx(tx)}</strong>
        <small className="mono">{tx.superblock ? `#${tx.superblock}` : 'pending'}</small>
      </span>
      <span className="mono tx-time right">{timeAgo(tx.ts, now)}</span>
    </button>
  );
}

function SuperblocksPage({
  superblocks,
  now,
  filter,
  setFilter,
  onSelect,
}: {
  superblocks: Superblock[];
  now: number;
  filter: SuperblockStatus | 'all';
  setFilter: (filter: SuperblockStatus | 'all') => void;
  onSelect: (sb: Superblock) => void;
}) {
  const counts = useMemo(() => {
    const base: Record<SuperblockStatus | 'all', number> = { all: superblocks.length, proposed: 0, validated: 0, finalized: 0 };
    superblocks.forEach((sb) => {
      base[sb.status] += 1;
    });
    return base;
  }, [superblocks]);
  const rows = filter === 'all' ? superblocks : superblocks.filter((sb) => sb.status === filter);
  const labels: Record<SuperblockStatus | 'all', string> = { all: 'All', ...SUPERBLOCK_STATUS_LABEL };

  return (
    <>
      <div className="explorer-titlebar">
        <h2>Superblocks</h2>
        <span className="live-mode mono">
          <i />
          LIVE MODE
          <b />
        </span>
      </div>
      <div className="page-toolbar">
        <div className="tx-toolbar-left">
          <FilterBar
            filters={['all', ...SUPERBLOCK_STATUSES]}
            active={filter}
            counts={counts}
            labels={labels}
            onSelect={setFilter}
          />
          <QueryPills items={['Period', 'Chains', 'Mailbox root', 'Time']} />
        </div>
        <span className="mono result-count">{rows.length} superblocks</span>
      </div>
      <div className="table-head sb-head dense">
        <span>Superblock</span>
        <span>Status</span>
        <span>Period</span>
        <span>Chains</span>
        <span>XTs</span>
        <span>Mailbox Root</span>
        <span>Age</span>
      </div>
      <div className="tx-dense-list">
        {rows.map((sb) => (
          <SuperblockTableRow key={sb.number} sb={sb} now={now} onClick={() => onSelect(sb)} />
        ))}
      </div>
      <Pager />
    </>
  );
}

function SuperblockDetailPage({ sb, now, back }: { sb: Superblock; now: number; back: () => void }) {
  const order: SuperblockStatus[] = ['proposed', 'validated', 'finalized'];
  const current = order.indexOf(sb.status);
  return (
    <>
      <button type="button" className="back-button" onClick={back}>
        &lt;- Superblocks
      </button>
      <div className="detail-hero compact">
        <div className="sb-title">
          <div className="big-icon">
            <LogoIcon />
          </div>
          <div>
            <strong className="mono">#{sb.number}</strong>
            <span className="mono muted">superblock - {timeAgo(sb.ts, now)}</span>
          </div>
        </div>
        <StatusPill status={sb.status} large />
        <div className="ladder">
          {order.map((status, idx) => (
            <div className="ladder-step" key={status}>
              <span className={idx <= current ? 'reached' : ''} style={{ background: idx <= current ? STATUS_VAR[status] : undefined }} />
              <strong>{SUPERBLOCK_STATUS_LABEL[status]}</strong>
              {idx < order.length - 1 && <i className={idx < current ? 'reached' : ''} />}
            </div>
          ))}
        </div>
      </div>
      <DetailMeta
        rows={[
          ['Superblock Hash', short(sb.hash)],
          ['Parent Hash', short(sb.parentHash)],
          ['Period', `P${sb.period}`],
          ['Mailbox Root', short(sb.mailboxRoot)],
          ['Cross-chain Txns', String(sb.xtCount)],
          ['Prove Time', `${Math.floor(sb.proveTime / 60)}m ${String(sb.proveTime % 60).padStart(2, '0')}s`],
          ['L1 Anchor', sb.l1Tx ? short(sb.l1Tx) : 'pending'],
          ['L1 Block', sb.l1Block ? `#${fmt(sb.l1Block)}` : '-'],
        ]}
      />
      <div className="two-col sb-detail-grid">
        <section className="panel">
          <h3>State Transitions</h3>
          <div className="mini-list">
            {sb.chains.map((block) => (
              <div className="block-row wide" key={block.chain.key}>
                <div>
                  <Glyph chain={block.chain} />
                  <strong>{block.chain.name}</strong>
                  <span className="mono">L2 #{fmt(block.l2Block)}</span>
                </div>
                <small className="mono">{short(block.preRoot)} -&gt; {short(block.postRoot)} - cfg {short(block.configHash)}</small>
              </div>
            ))}
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

function InstancesPage({ txs, now, onSelect }: { txs: Tx[]; now: number; onSelect: (tx: Tx) => void }) {
  return (
    <>
      <div className="explorer-titlebar">
        <h2>Instances</h2>
        <span className="live-mode mono">
          <i />
          LIVE MODE
          <b />
        </span>
      </div>
      <div className="intro-line">
        <p>Each composability instance is scheduled by the Shared Publisher with instance_id = H(period | seq | XTRequest).</p>
        <span className="mono">{txs.length} instances in view</span>
      </div>
      <div className="page-toolbar">
        <QueryPills items={['Decision', 'Period', 'Participants', 'Time']} />
        <span className="mono result-count">{txs.length} results</span>
      </div>
      <div className="table-head inst-head dense">
        <span>Instance</span>
        <span>Period / Seq</span>
        <span>Chains</span>
        <span>Votes</span>
        <span>Decision</span>
        <span>Protocol</span>
        <span>Age</span>
      </div>
      <div className="tx-dense-list">
        {txs.slice(0, 36).map((tx) => (
          <InstanceTableRow key={tx.id} tx={tx} now={now} onClick={() => onSelect(tx)} />
        ))}
      </div>
      <Pager />
    </>
  );
}

function InstanceDetailPage({ tx, back }: { tx: Tx; back: () => void }) {
  return (
    <>
      <button type="button" className="back-button" onClick={back}>
        &lt;- Instances
      </button>
      <div className="detail-hero compact instance-hero">
        <div className="sb-title">
          <div className="big-icon linked">
            <LogoIcon />
          </div>
          <div>
            <span className="mono muted">Instance</span>
            <strong className="mono">{instanceId(tx)}</strong>
          </div>
        </div>
        <div className="decision-line">
          <span>decision</span>
          <span className={tx.decision === 'commit' ? 'decision commit' : 'decision abort'}>{tx.decision.toUpperCase()}</span>
        </div>
      </div>
      <div className="two-col">
        <section className="panel">
          <h3>StartInstance</h3>
          <DetailRows
            rows={[
              ['instance_id', instanceId(tx)],
              ['period_id', `P${tx.periodId}`],
              ['sequence', String(tx.sequence)],
              ['XTRequest', short(tx.id, 8, 5)],
            ]}
          />
          <div className="participants">
            <span className="mono">Participating sequencers</span>
            <div>
              {tx.chains.map((chain) => (
                <span key={chain.key}>
                  <Glyph chain={chain} size={20} />
                  {chain.name}
                </span>
              ))}
            </div>
          </div>
        </section>
        <section className="panel">
          <PanelHeader title="2PC Votes" value={`${tx.votes.filter((vote) => vote.vote).length}/${tx.votes.length}`} />
          <div className="mini-list">
            {tx.votes.map((vote) => (
              <div className="mini-row" key={vote.chain.key}>
                <Glyph chain={vote.chain} />
                <strong>{vote.chain.name}</strong>
                <span className="mono muted">{clock(vote.ms)}</span>
                <span className={vote.vote ? 'decision commit' : 'decision abort'}>{vote.vote ? 'COMMIT' : 'ABORT'}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
      <section className="panel panel-spaced">
        <h3>Mailbox Exchange</h3>
        <div className="message-list">
          {tx.mailbox.map((msg) => (
            <MessageRow key={msg.id} msg={msg} now={Date.now()} />
          ))}
        </div>
      </section>
    </>
  );
}

function DetailRows({ rows }: { rows: Array<[string, string]> }) {
  return (
    <div className="detail-rows">
      {rows.map(([key, value]) => (
        <div key={key}>
          <span className="mono">{key}</span>
          <strong className="mono">{value}</strong>
        </div>
      ))}
    </div>
  );
}

function MailboxPage({
  mailboxes,
  selected,
  setSelected,
  now,
}: {
  mailboxes: MailboxCounterparty[];
  selected: string;
  setSelected: (key: string) => void;
  now: number;
}) {
  const active = mailboxes.find((mailbox) => mailbox.chain.key === selected) ?? mailboxes[0]!;
  return (
    <>
      <div className="explorer-titlebar">
        <h2>Mailbox</h2>
        <span className="live-mode mono">
          <i />
          ROOT MODE
          <b />
        </span>
      </div>
      <div className="mailbox-layout">
        <aside className="side-list">
          <h3>Counterparties</h3>
          {mailboxes.map((mailbox) => (
            <button
              type="button"
              key={mailbox.chain.key}
              className={mailbox.chain.key === active.chain.key ? 'side-item active' : 'side-item'}
              onClick={() => setSelected(mailbox.chain.key)}
            >
              <Glyph chain={mailbox.chain} />
              <span>
                <strong>{mailbox.chain.name}</strong>
                <small className="mono">{mailbox.inCount} in / {mailbox.outCount} out</small>
              </span>
            </button>
          ))}
        </aside>
        <section>
          <div className="mailbox-hero">
            <div className="mailbox-title">
              <Glyph chain={HOST} />
              <span>&lt;-&gt;</span>
              <Glyph chain={active.chain} />
              <strong>Ethera &lt;-&gt; {active.chain.name}</strong>
            </div>
            <span className="consistency"><i />Roots consistent</span>
            <div className="root-grid">
              <div>
                <span className="mono">Inbox Root</span>
                <strong className="mono">{short(active.inboxRoot, 9, 6)}</strong>
                <small className="mono">{active.inCount} msgs</small>
              </div>
              <div>
                <span className="mono">Outbox Root</span>
                <strong className="mono">{short(active.outboxRoot, 9, 6)}</strong>
                <small className="mono">{active.outCount} msgs</small>
              </div>
            </div>
          </div>
          <div className="page-toolbar mailbox-toolbar">
            <QueryPills items={['Direction', 'Session', 'Superblock', 'Time']} />
            <span className="mono result-count">{active.messages.length} messages</span>
          </div>
          <div className="table-head mailbox-head dense">
            <span>Direction</span>
            <span>From</span>
            <span />
            <span>To</span>
            <span>Message</span>
            <span>Session</span>
            <span>Superblock</span>
            <span>Age</span>
          </div>
          <div className="tx-dense-list">
            {active.messages.map((msg) => (
              <MailboxTableRow key={msg.id} msg={msg} now={now} />
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

function MailboxTableRow({ msg, now }: { msg: MailboxMessage; now: number }) {
  return (
    <div className="dense-table-row mailbox-table-row">
      <span className={msg.direction === 'in' ? 'message-dir in' : 'message-dir out'}>{msg.direction === 'in' ? 'INBOX' : 'OUTBOX'}</span>
      <span className="tx-address-cell">
        <Glyph chain={msg.from} size={18} />
        <span>
          <strong>{msg.from.name}</strong>
          <small className="mono">{short(msg.data, 5, 4)}</small>
        </span>
      </span>
      <span className="tx-direction" aria-hidden="true">
        -&gt;
      </span>
      <span className="tx-address-cell">
        <Glyph chain={msg.to} size={18} />
        <span>
          <strong>{msg.to.name}</strong>
          <small>{msg.direction === 'in' ? 'host inbox' : 'counterparty inbox'}</small>
        </span>
      </span>
      <span className="tx-protocol-cell">
        <strong>{msg.label}</strong>
        <small>{msg.direction === 'in' ? 'received' : 'emitted'}</small>
      </span>
      <span className="tx-hash-cell">
        <strong className="mono">session {short(msg.session, 4, 3)}</strong>
        <CopyIcon />
      </span>
      <span className="mono tx-time">#{msg.superblock}</span>
      <span className="mono tx-time right">{timeAgo(msg.ts, now)}</span>
    </div>
  );
}

function MessageRow({ msg, now }: { msg: MailboxMessage; now: number }) {
  return (
    <div className="message-row">
      <span className={msg.direction === 'in' ? 'message-dir in' : 'message-dir out'}>{msg.direction === 'in' ? 'INBOX' : 'OUTBOX'}</span>
      <div className="message-route">
        <Glyph chain={msg.from} size={24} />
        <span>-&gt;</span>
        <Glyph chain={msg.to} size={24} />
      </div>
      <strong>{msg.label}</strong>
      <span className="mono muted">session {short(msg.session, 4, 3)}</span>
      <span className="mono">{short(msg.data, 5, 4)}</span>
      <span className="mono muted">#{msg.superblock}</span>
      <span className="mono right muted">{timeAgo(msg.ts, now)}</span>
    </div>
  );
}

function RollupsPage({ txs, mailboxes, onSelect }: { txs: Tx[]; mailboxes: MailboxCounterparty[]; onSelect: (chain: Chain) => void }) {
  return (
    <>
      <div className="intro-line">
        <p>Rollups settling into the Ethera network. CrossScout is scoped to Ethera and every counterparty it exchanges cross-chain transactions with.</p>
      </div>
      <div className="rollup-grid">
        {CHAINS.map((chain) => {
          const rel = txs.filter((tx) => tx.src.key === chain.key || tx.dst.key === chain.key);
          const mailbox = mailboxes.find((item) => item.chain.key === chain.key);
          const volume = rel.reduce((sum, tx) => sum + tx.value, 0) * 9;
          return (
            <button
              type="button"
              className={chain.current ? 'rollup-card current' : 'rollup-card'}
              key={chain.key}
              onClick={() => !chain.current && onSelect(chain)}
            >
              <div className="rollup-card-head">
                <Glyph chain={chain} size={40} />
                <div>
                  <strong>{chain.name}</strong>
                  <span className="mono">chain #{chain.chainId}</span>
                </div>
                <small className="mono">{chain.current ? 'THIS ROLLUP' : 'COUNTERPARTY'}</small>
              </div>
              <div className="rollup-stats">
                <div><span>XTs</span><strong className="mono">{chain.current ? fmt(txs.length) : fmt(rel.length)}</strong></div>
                <div><span>Volume</span><strong className="mono">{formatUsd(volume)}</strong></div>
                <div><span>Block Time</span><strong className="mono">{chain.blockTime}</strong></div>
                <div><span>Mailbox</span><strong className="ok-text">{mailbox || chain.current ? 'consistent' : 'pending'}</strong></div>
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}

function RollupDetailPage({
  chain,
  txs,
  mailbox,
  now,
  back,
  onTx,
}: {
  chain: Chain;
  txs: Tx[];
  mailbox: MailboxCounterparty | undefined;
  now: number;
  back: () => void;
  onTx: (tx: Tx) => void;
}) {
  const rel = txs.filter((tx) => tx.src.key === chain.key || tx.dst.key === chain.key);
  const volume = rel.reduce((sum, tx) => sum + tx.value, 0) * 9;
  return (
    <>
      <button type="button" className="back-button" onClick={back}>
        &lt;- Rollups
      </button>
      <div className="detail-hero compact rollup-detail-hero">
        <Glyph chain={chain} size={52} />
        <div>
          <strong>{chain.name}</strong>
          <span className="mono muted">chain #{chain.chainId} - {chain.blockTime} blocks - settles into Ethera</span>
        </div>
        <span className="consistency"><i />active</span>
      </div>
      <div className="stats-grid small">
        {[
          ['Cross-chain Txns', fmt(rel.length)],
          ['Volume w/ Ethera', formatUsd(volume)],
          ['Inbox / Outbox', `${mailbox?.inCount ?? 0} / ${mailbox?.outCount ?? 0}`],
          ['Block Time', chain.blockTime],
        ].map(([label, value]) => (
          <div className="stat-cell" key={label}>
            <span className="stat-label mono">{label}</span>
            <strong className="stat-value mono">{value}</strong>
          </div>
        ))}
      </div>
      <section className="panel panel-spaced">
        <h3>Mailbox Roots With Ethera</h3>
        <div className="root-grid standalone">
          <div>
            <span className="mono">Inbox Root</span>
            <strong className="mono">{short(mailbox?.inboxRoot, 9, 6)}</strong>
          </div>
          <div>
            <span className="mono">Outbox Root</span>
            <strong className="mono">{short(mailbox?.outboxRoot, 9, 6)}</strong>
          </div>
        </div>
      </section>
      <SectionTitle title="Recent cross-chain transactions" />
      <div className="tx-feed">
        {rel.slice(0, 8).map((tx) => (
          <TxRow key={tx.id} tx={tx} now={now} onClick={() => onTx(tx)} />
        ))}
      </div>
    </>
  );
}

function SearchResults({
  query,
  txs,
  superblocks,
  setRoute,
  setQuery,
}: {
  query: string;
  txs: Tx[];
  superblocks: Superblock[];
  setRoute: (route: Route) => void;
  setQuery: (query: string) => void;
}) {
  const q = query.trim().toLowerCase();
  if (!q) return null;

  const txHits = txs
    .filter((tx) => tx.id.toLowerCase().includes(q) || instanceId(tx).toLowerCase().includes(q) || tx.sender.toLowerCase().includes(q) || String(tx.periodId).includes(q))
    .slice(0, 5);
  const sbHits = superblocks.filter((sb) => String(sb.number).includes(q) || sb.hash.toLowerCase().includes(q)).slice(0, 4);
  const chainHits = CHAINS.filter((chain) => chain.name.toLowerCase().includes(q) || String(chain.chainId).includes(q)).slice(0, 4);
  const hasHits = txHits.length + sbHits.length + chainHits.length > 0;

  const go = (route: Route) => {
    setQuery('');
    navTo(route, setRoute);
  };

  return (
    <div className="search-popover">
      {!hasHits && (
        <div className="no-results">
          No matches for <span className="mono">{query}</span>
        </div>
      )}
      {txHits.length > 0 && (
        <SearchGroup title="Transactions">
          {txHits.map((tx) => (
            <button type="button" className="search-row" key={tx.id} onClick={() => go({ name: 'txDetail', id: tx.id })}>
              <Glyph chain={tx.src} />
              <span>
                <strong className="mono">{short(tx.id, 8, 5)}</strong>
                <small>{tx.src.name} to {tx.dst.name} - P{tx.periodId}</small>
              </span>
              <i>-&gt;</i>
            </button>
          ))}
        </SearchGroup>
      )}
      {sbHits.length > 0 && (
        <SearchGroup title="Superblocks">
          {sbHits.map((sb) => (
            <button type="button" className="search-row" key={sb.number} onClick={() => go({ name: 'superblockDetail', number: sb.number })}>
              <span className="search-glyph">SB</span>
              <span>
                <strong>Superblock #{sb.number}</strong>
                <small>{sb.xtCount} XTs - {sb.status}</small>
              </span>
              <i>-&gt;</i>
            </button>
          ))}
        </SearchGroup>
      )}
      {chainHits.length > 0 && (
        <SearchGroup title="Rollups">
          {chainHits.map((chain) => (
            <button type="button" className="search-row" key={chain.key} onClick={() => go(chain.current ? { name: 'overview' } : { name: 'rollupDetail', key: chain.key })}>
              <Glyph chain={chain} />
              <span>
                <strong>{chain.name}</strong>
                <small>chain #{chain.chainId}</small>
              </span>
              <i>-&gt;</i>
            </button>
          ))}
        </SearchGroup>
      )}
    </div>
  );
}

function SearchGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="search-group">
      <h3 className="mono">{title}</h3>
      {children}
    </div>
  );
}

function AppHeader({
  route,
  theme,
  setTheme,
  network,
  setNetwork,
  query,
  setQuery,
  switcherOpen,
  setSwitcherOpen,
  setRoute,
}: {
  route: Route;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  network: Network;
  setNetwork: (network: Network) => void;
  query: string;
  setQuery: (query: string) => void;
  switcherOpen: boolean;
  setSwitcherOpen: (open: boolean) => void;
  setRoute: (route: Route) => void;
}) {
  const navLinks: Array<[string, Route, string[]]> = [
    ['TRANSACTIONS', { name: 'txs' }, ['txs', 'txDetail']],
    ['SUPERBLOCKS', { name: 'superblocks' }, ['superblocks', 'superblockDetail']],
    ['INSTANCES', { name: 'instances' }, ['instances', 'instanceDetail']],
    ['MAILBOX', { name: 'mailbox' }, ['mailbox']],
    ['ROLLUPS', { name: 'rollups' }, ['rollups', 'rollupDetail']],
  ];
  const routeKey = routeToKey(route);

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <button type="button" className="brand" onClick={() => navTo({ name: 'overview' }, setRoute)}>
            <LogoIcon />
            <span>
              <strong>CrossScout</strong>
              <small className="mono">ETHERA NETWORK</small>
            </span>
          </button>
          <nav>
            {navLinks.map(([label, to, activeKeys]) => (
              <button
                type="button"
                key={label}
                className={activeKeys.includes(routeKey) ? 'nav-link active' : 'nav-link'}
                onClick={() => navTo(to, setRoute)}
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="topbar-spacer" />
          <div className="switcher">
            <button type="button" className="switcher-button" onClick={() => setSwitcherOpen(!switcherOpen)}>
              <Glyph chain={HOST} size={20} />
              <strong className="mono">ETHERA</strong>
              <span>v</span>
            </button>
            {switcherOpen && (
              <div className="switcher-menu">
                <p className="mono">Each rollup runs its own explorer</p>
                {CHAINS.map((chain) => (
                  <button
                    type="button"
                    key={chain.key}
                    className={chain.current ? 'active' : ''}
                    onClick={() => {
                      setSwitcherOpen(false);
                      navTo(chain.current ? { name: 'overview' } : { name: 'rollupDetail', key: chain.key }, setRoute);
                    }}
                  >
                    <Glyph chain={chain} size={24} />
                    <strong>{chain.name}</strong>
                    <span className="mono">{chain.current ? 'this explorer' : `#${chain.chainId}`}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="segmented">
            {(['Mainnet', 'Testnet'] as Network[]).map((item) => (
              <button type="button" className={network === item ? 'active' : ''} key={item} onClick={() => setNetwork(item)}>
                {item}
              </button>
            ))}
          </div>
          <div className="segmented icon-segmented">
            <button type="button" className={theme === 'light' ? 'active' : ''} onClick={() => setTheme('light')} aria-label="Light theme">
              <SunIcon />
            </button>
            <button type="button" className={theme === 'dark' ? 'active' : ''} onClick={() => setTheme('dark')} aria-label="Dark theme">
              <MoonIcon />
            </button>
          </div>
        </div>
      </header>
      <div className="search-band">
        <div className="search-inner">
          <div className="search-box">
            <SearchIcon />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by tx hash, instance ID, superblock or address"
            />
            <span className="mono">CMD K</span>
          </div>
        </div>
      </div>
    </>
  );
}

export function App() {
  const [now, setNow] = useState(() => Date.now());
  const [theme, setTheme] = useState<Theme>('dark');
  const [network, setNetwork] = useState<Network>('Mainnet');
  const [route, setRoute] = useState<Route>({ name: 'overview' });
  const [query, setQuery] = useState('');
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [txFilter, setTxFilter] = useState<Status | 'all'>('all');
  const [sbFilter, setSbFilter] = useState<SuperblockStatus | 'all'>('all');
  const [selectedMailbox, setSelectedMailbox] = useState('solara');
  const [txs, setTxs] = useState<Tx[]>(() => buildMockTxs(Date.now()));
  const [superblocks] = useState<Superblock[]>(() => buildSuperblocks(Date.now()));

  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    const live = window.setInterval(() => {
      setTxs((current) => [makeLiveTx(Date.now()), ...current.map((tx, idx) => (idx === 4 && tx.status === 'pending' ? { ...tx, status: 'unsafe' as Status, stage: 7, superblock: 18470 } : tx))].slice(0, 80));
    }, 4200);
    return () => {
      window.clearInterval(tick);
      window.clearInterval(live);
    };
  }, []);

  const mailboxes = useMemo(() => buildMailboxes(txs), [txs]);
  const currentTx = route.name === 'txDetail' || route.name === 'instanceDetail' ? txs.find((tx) => tx.id === route.id) : undefined;
  const currentSb = route.name === 'superblockDetail' ? superblocks.find((sb) => sb.number === route.number) : undefined;
  const currentRollup = route.name === 'rollupDetail' ? CHAIN_BY_KEY[route.key] : undefined;

  const goTx = (tx: Tx) => navTo({ name: 'txDetail', id: tx.id }, setRoute);
  const goInstance = (tx: Tx) => navTo({ name: 'instanceDetail', id: tx.id }, setRoute);

  let content: JSX.Element;
  switch (route.name) {
    case 'txs':
      content = <TransactionsPage txs={txs} now={now} filter={txFilter} setFilter={setTxFilter} onTx={goTx} />;
      break;
    case 'txDetail':
      content = currentTx ? <TxDetailPage tx={currentTx} now={now} back={() => navTo({ name: 'txs' }, setRoute)} /> : <NotFound back={() => navTo({ name: 'txs' }, setRoute)} />;
      break;
    case 'superblocks':
      content = (
        <SuperblocksPage
          superblocks={superblocks}
          now={now}
          filter={sbFilter}
          setFilter={setSbFilter}
          onSelect={(sb) => navTo({ name: 'superblockDetail', number: sb.number }, setRoute)}
        />
      );
      break;
    case 'superblockDetail':
      content = currentSb ? <SuperblockDetailPage sb={currentSb} now={now} back={() => navTo({ name: 'superblocks' }, setRoute)} /> : <NotFound back={() => navTo({ name: 'superblocks' }, setRoute)} />;
      break;
    case 'instances':
      content = <InstancesPage txs={txs} now={now} onSelect={goInstance} />;
      break;
    case 'instanceDetail':
      content = currentTx ? <InstanceDetailPage tx={currentTx} back={() => navTo({ name: 'instances' }, setRoute)} /> : <NotFound back={() => navTo({ name: 'instances' }, setRoute)} />;
      break;
    case 'mailbox':
      content = <MailboxPage mailboxes={mailboxes} selected={selectedMailbox} setSelected={setSelectedMailbox} now={now} />;
      break;
    case 'rollups':
      content = <RollupsPage txs={txs} mailboxes={mailboxes} onSelect={(chain) => navTo({ name: 'rollupDetail', key: chain.key }, setRoute)} />;
      break;
    case 'rollupDetail':
      content = currentRollup ? (
        <RollupDetailPage
          chain={currentRollup}
          txs={txs}
          mailbox={mailboxes.find((mailbox) => mailbox.chain.key === currentRollup.key)}
          now={now}
          back={() => navTo({ name: 'rollups' }, setRoute)}
          onTx={goTx}
        />
      ) : (
        <NotFound back={() => navTo({ name: 'rollups' }, setRoute)} />
      );
      break;
    default:
      content = <OverviewPage txs={txs} now={now} network={network} onTxs={() => navTo({ name: 'txs' }, setRoute)} onTx={goTx} />;
  }

  return (
    <div className="app-shell" data-theme={theme}>
      <AppHeader
        route={route}
        theme={theme}
        setTheme={setTheme}
        network={network}
        setNetwork={setNetwork}
        query={query}
        setQuery={setQuery}
        switcherOpen={switcherOpen}
        setSwitcherOpen={setSwitcherOpen}
        setRoute={setRoute}
      />
      <div className="search-anchor">
        <SearchResults query={query} txs={txs} superblocks={superblocks} setRoute={setRoute} setQuery={setQuery} />
      </div>
      <main>{content}</main>
    </div>
  );
}

function NotFound({ back }: { back: () => void }) {
  return (
    <div className="not-found">
      <h2>Record not found</h2>
      <Button variant="solid" size="lg" onClick={back}>
        Back
      </Button>
    </div>
  );
}
