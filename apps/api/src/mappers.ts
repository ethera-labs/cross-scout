// Postgres row (snake_case) → DTO (camelCase) mappers. The DTO shapes are the
// SDK's; producing exactly these keeps the REST responses and the Redis stream
// interchangeable for the explorer.

import type {
  ActivityPoint,
  AssetVolume,
  Instance,
  MailboxMessage,
  PeriodInfo,
  PublisherSnapshot,
  Superblock,
  SuperblockChain,
  TokenMeta,
  Transfer,
  Xt,
} from '@cross-scout/sdk';
import { numberArray, numOrNull, pgIntArray, toHex, toIso, toIsoOrNull } from './convert.ts';

// Rows are dynamically shaped; `any` here is deliberate and contained.
/* eslint-disable @typescript-eslint/no-explicit-any */

export function toXt(r: any): Xt {
  return {
    xtHash: toHex(r.xt_hash)!,
    srcChain: numOrNull(r.src_chain),
    dstChain: numOrNull(r.dst_chain),
    chains: numberArray(r.chains),
    sender: toHex(r.sender),
    receiver: toHex(r.receiver),
    label: r.label ?? null,
    srcTxHash: toHex(r.src_tx_hash),
    valueWei: r.value_wei != null ? String(r.value_wei) : null,
    status: r.status,
    stage: Number(r.stage),
    superblockNumber: numOrNull(r.superblock_number),
    firstSeenAt: toIso(r.first_seen_at),
    preconfirmedAt: toIsoOrNull(r.preconfirmed_at),
    includedAt: toIsoOrNull(r.included_at),
    settledAt: toIsoOrNull(r.settled_at),
    finalizedAt: toIsoOrNull(r.finalized_at),
    failedAt: toIsoOrNull(r.failed_at),
    updatedAt: toIso(r.updated_at),
  };
}

export function toInstance(r: any): Instance {
  return {
    session: toHex(r.session)!,
    xtHash: toHex(r.xt_hash),
    participants: numberArray(r.participants),
    decision: r.decision,
    startedAt: toIsoOrNull(r.started_at),
    decidedAt: toIsoOrNull(r.decided_at),
  };
}

export function toMailbox(r: any): MailboxMessage {
  return {
    id: Number(r.id),
    direction: r.direction,
    srcChain: numOrNull(r.src_chain),
    dstChain: numOrNull(r.dst_chain),
    session: toHex(r.session),
    sender: toHex(r.sender),
    receiver: toHex(r.receiver),
    label: r.label ?? null,
    xtHash: toHex(r.xt_hash),
    superblockNumber: numOrNull(r.superblock_number),
    chainId: Number(r.chain_id),
    blockHash: toHex(r.block_hash)!,
    logIndex: Number(r.log_index),
    txHash: toHex(r.tx_hash),
    ts: toIso(r.ts),
  };
}

export function toSuperblockChain(r: any): SuperblockChain {
  return {
    superblockNumber: Number(r.superblock_number),
    chainId: Number(r.chain_id),
    l2Block: numOrNull(r.l2_block),
    preRoot: toHex(r.pre_root),
    postRoot: toHex(r.post_root),
    configHash: toHex(r.config_hash),
  };
}

export function toSuperblock(r: any, chains: SuperblockChain[]): Superblock {
  return {
    number: Number(r.number),
    hash: toHex(r.hash),
    parentHash: toHex(r.parent_hash),
    status: r.status,
    rootClaim: toHex(r.root_claim),
    gameAddress: toHex(r.game_address),
    xtCount: Number(r.xt_count),
    proveMs: numOrNull(r.prove_ms),
    l1Tx: toHex(r.l1_tx),
    l1Block: numOrNull(r.l1_block),
    proposedAt: toIsoOrNull(r.proposed_at),
    validatedAt: toIsoOrNull(r.validated_at),
    finalizedAt: toIsoOrNull(r.finalized_at),
    chains,
  };
}

export function toTransfer(r: any): Transfer {
  return {
    id: Number(r.id),
    session: toHex(r.session)!,
    kind: r.kind,
    token: toHex(r.token),
    amount: String(r.amount),
    srcChain: Number(r.src_chain),
    dstChain: Number(r.dst_chain),
    sender: toHex(r.sender)!,
    receiver: toHex(r.receiver)!,
    messageId: toHex(r.message_id),
    chainId: Number(r.chain_id),
    txHash: toHex(r.tx_hash),
    safe: Boolean(r.safe),
    ts: toIso(r.ts),
  };
}

export function toTokenMeta(r: any): TokenMeta {
  return {
    chainId: Number(r.chain_id),
    address: toHex(r.address)!,
    symbol: r.symbol ?? null,
    name: r.name ?? null,
    decimals: numOrNull(r.decimals),
  };
}

export function toSnapshot(r: any): PublisherSnapshot {
  return {
    ts: toIso(r.ts),
    periodId: Number(r.period_id),
    nextSuperblock: Number(r.next_superblock),
    lastFinalized: Number(r.last_finalized),
    queued: Number(r.queued),
    activeXts: Number(r.active_xts),
    activeChains: Number(r.active_chains),
    connections: Number(r.connections),
    registeredChains: Number(r.registered_chains),
    pendingProofs: Number(r.pending_proofs),
  };
}

export function toPeriod(r: any): PeriodInfo {
  return {
    periodId: Number(r.period_id),
    superblockNumber: numOrNull(r.superblock_number),
    firstSeenAt: toIso(r.first_seen_at),
    lastSeenAt: toIso(r.last_seen_at),
  };
}

export function toActivityPoint(r: any): ActivityPoint {
  return {
    bucket: toIso(r.bucket),
    count: Number(r.count),
    volumeWei: String(r.volume_wei ?? '0'),
    transfers: Number(r.transfers),
  };
}

export function toAssetVolume(r: any, token: TokenMeta | null): AssetVolume {
  const chains = [...new Set([...pgIntArray(r.src_chains), ...pgIntArray(r.dst_chains)])].sort(
    (a, b) => a - b,
  );
  return {
    token,
    transfers: Number(r.transfers),
    amount: String(r.amount ?? '0'),
    chains,
  };
}
