// Domain types shared between the api and the explorer.
//
// These are hand-maintained copies of the Rust DTOs in `crates/types`, which
// are the source of truth. Regenerate the machine copy under `src/generated/`
// with `bun run gen:types` and diff it against this file when the Rust types
// change.
//
// All byte values are `0x`-prefixed hex; all timestamps are RFC-3339; all chain
// ids are numbers. `bigint`-scale values (wei) are decimal strings.

export type XtStatus = 'pending' | 'unsafe' | 'validated' | 'finalized' | 'failed';
export type Decision = 'pending' | 'commit' | 'abort';
export type Direction = 'in' | 'out';
export type SuperblockStatus = 'proposed' | 'validated' | 'finalized';

/** Human-readable lifecycle stage names, indexed by the numeric `stage` (1..9). */
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

export interface Xt {
  xtHash: string;
  instanceId: string;
  period: number | null;
  seq: number | null;
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

export interface Vote {
  instanceId: string;
  chainId: number;
  commit: boolean;
  votedAt: string;
}

export interface Instance {
  instanceId: string;
  xtHash: string | null;
  period: number | null;
  seq: number | null;
  participants: number[];
  decision: Decision;
  startedAt: string | null;
  decidedAt: string | null;
  votes: Vote[];
}

export interface MailboxMessage {
  id: number;
  direction: Direction;
  srcChain: number | null;
  dstChain: number | null;
  session: string | null;
  header: string | null;
  bodyHash: string | null;
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
  period: number | null;
  status: SuperblockStatus;
  mailboxRoot: string | null;
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
  pending: number;
  recentXts: Xt[];
}

/** Mailbox view for `GET /v1/mailbox/:chain`. */
export interface MailboxView {
  chainId: number;
  outboxRoot: string | null;
  inboxRoot: string | null;
  messages: MailboxMessage[];
}

export type StreamEvent =
  | { type: 'newXt'; xt: Xt }
  | { type: 'xtUpdated'; xt: Xt }
  | { type: 'vote'; vote: Vote }
  | { type: 'superblockUpdated'; superblock: Superblock };
