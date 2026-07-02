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
  instanceId: string;
  srcChain: number | null;
  dstChain: number | null;
  chains: number[];
  sender: string | null;
  valueWei: string | null;
  status: XtStatus;
  stage: number;
  superblockNumber: number | null;
  firstSeenAt: string;
  updatedAt: string;
}

export interface Instance {
  instanceId: string;
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
  xtCount: number;
  proveMs: number | null;
  l1Tx: string | null;
  l1Block: number | null;
  proposedAt: string | null;
  validatedAt: string | null;
  finalizedAt: string | null;
  chains: SuperblockChain[];
}

export interface XtDetail {
  xt: Xt;
  instance: Instance | null;
  mailbox: MailboxMessage[];
  superblock: Superblock | null;
}

export interface RouteVolume {
  srcChain: number;
  dstChain: number;
  count: number;
  valueWei: string;
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
