// Domain types shared between the api and the explorer.
//
// These are hand-maintained copies of the Rust DTOs in `crates/types`, which
// are the source of truth. Regenerate the machine copy under `src/generated/`
// with `bun run gen:types` and diff it against this file when the Rust types
// change.
//
// All byte values are `0x`-prefixed hex; all timestamps are RFC-3339; all chain
// ids are numbers. `bigint`-scale values (wei) are decimal strings.

export type XtStatus = 'pending' | 'committed' | 'validated' | 'finalized' | 'failed';
export type Decision = 'pending' | 'commit' | 'abort';
export type Direction = 'in' | 'out';
export type SuperblockStatus = 'proposed' | 'validated' | 'finalized';

/**
 * Human-readable lifecycle stage names, indexed by the numeric `stage` (1..9).
 * Stages 2..5 are the publisher's off-chain 2PC phases; live ingestion jumps
 * `requested → included`, so they only appear if the publisher ever exposes an
 * event stream.
 */
export const STAGE_NAMES = [
  'unknown',
  'requested',
  'scheduled',
  'simulating',
  'voting',
  'decided',
  'included',
  'settled',
  'validated',
  'finalized',
] as const;

/** The terminal rollback stage (`xts.stage = 255`). */
export const STAGE_ROLLED_BACK = 255;

export interface Xt {
  xtHash: string;
  srcChain: number | null;
  dstChain: number | null;
  chains: number[];
  sender: string | null;
  receiver: string | null;
  label: string | null;
  srcTxHash: string | null;
  valueWei: string | null;
  status: XtStatus;
  stage: number;
  superblockNumber: number | null;
  firstSeenAt: string;
  preconfirmedAt: string | null;
  includedAt: string | null;
  settledAt: string | null;
  finalizedAt: string | null;
  failedAt: string | null;
  updatedAt: string;
}

export interface Instance {
  session: string;
  xtHash: string | null;
  participants: number[];
  decision: Decision;
  startedAt: string | null;
  decidedAt: string | null;
}

export interface MailboxMessage {
  id: number;
  direction: Direction;
  srcChain: number | null;
  dstChain: number | null;
  session: string | null;
  sender: string | null;
  receiver: string | null;
  label: string | null;
  xtHash: string | null;
  superblockNumber: number | null;
  chainId: number;
  blockHash: string;
  logIndex: number;
  txHash: string | null;
  ts: string;
}

export interface SuperblockChain {
  superblockNumber: number;
  chainId: number;
  l2Block: number | null;
  preRoot: string | null;
  postRoot: string | null;
  configHash: string | null;
}

export interface Superblock {
  number: number;
  hash: string | null;
  parentHash: string | null;
  status: SuperblockStatus;
  rootClaim: string | null;
  gameAddress: string | null;
  xtCount: number;
  proveMs: number | null;
  l1Tx: string | null;
  l1Block: number | null;
  proposedAt: string | null;
  validatedAt: string | null;
  finalizedAt: string | null;
  chains: SuperblockChain[];
}

export interface Transfer {
  id: number;
  session: string;
  kind: 'eth' | 'erc20';
  token: string | null;
  amount: string;
  srcChain: number;
  dstChain: number;
  sender: string;
  receiver: string;
  messageId: string | null;
  chainId: number;
  txHash: string | null;
  safe: boolean;
  ts: string;
}

export interface TokenMeta {
  chainId: number;
  address: string;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
}

export interface XtDetail {
  xt: Xt;
  instance: Instance | null;
  mailbox: MailboxMessage[];
  superblock: Superblock | null;
  transfers: Transfer[];
  tokens: TokenMeta[];
}

export interface RouteVolume {
  srcChain: number;
  dstChain: number;
  count: number;
  valueWei: string;
  transfers: number;
}

export interface StatsWindow {
  xts: number;
  transfers: number;
  volumeWei: string;
  messages: number;
}

export interface NetworkStats {
  hostChain: number;
  totalXts: number;
  pending: number;
  committed: number;
  validated: number;
  finalized: number;
  failed: number;
  superblocks: number;
  avgProveMs: number | null;
  routes: RouteVolume[];
  window24h: StatsWindow;
  commitRate: number | null;
  lastFinalizedSuperblock: number | null;
}

export interface ActivityPoint {
  bucket: string;
  count: number;
  volumeWei: string;
  transfers: number;
}

export interface AssetVolume {
  token: TokenMeta | null;
  transfers: number;
  amount: string;
  chains: number[];
}

export interface PublisherSnapshot {
  ts: string;
  periodId: number;
  nextSuperblock: number;
  lastFinalized: number;
  queued: number;
  activeXts: number;
  activeChains: number;
  connections: number;
  registeredChains: number;
  pendingProofs: number;
}

export interface PeriodInfo {
  periodId: number;
  superblockNumber: number | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface XtPage {
  items: Xt[];
  nextCursor: string | null;
}

/** Per-rollup counterparty view for `GET /v1/rollups/:chain`. */
export interface RollupView {
  chainId: number;
  xtCount: number;
  finalized: number;
  committed: number;
  pending: number;
  recentXts: Xt[];
}

/** Mailbox view for `GET /v1/mailbox/:chain`. */
export interface MailboxView {
  chainId: number;
  inCount: number;
  outCount: number;
  messages: MailboxMessage[];
}

export type StreamEvent =
  | { type: 'newXt'; xt: Xt }
  | { type: 'xtUpdated'; xt: Xt }
  | { type: 'superblockUpdated'; superblock: Superblock };

/** TS-only: assembled by the api, no Rust DTO. */
export interface NetworkView {
  publisher: PublisherSnapshot | null;
  periods: PeriodInfo[];
  series: PublisherSnapshot[];
}

export type SearchResult =
  | { type: 'xt'; xt: Xt }
  | { type: 'superblock'; superblock: Superblock }
  | { type: 'address'; address: string; xtCount: number }
  | { type: 'token'; token: TokenMeta };

export interface SearchResponse {
  query: string;
  results: SearchResult[];
}
