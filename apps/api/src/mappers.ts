// Postgres row (snake_case) → DTO (camelCase) mappers. The DTO shapes are the
// SDK's; producing exactly these keeps the REST responses and the Redis stream
// interchangeable for the explorer.

import type {
  Instance,
  MailboxMessage,
  Superblock,
  SuperblockChain,
  Xt,
} from '@cross-scout/sdk';
import { numOrNull, toHex, toIso, toIsoOrNull } from './hex.ts';

// Rows are dynamically shaped; `any` here is deliberate and contained.
/* eslint-disable @typescript-eslint/no-explicit-any */

function numberArray(value: ArrayLike<number> | null | undefined): number[] {
  return Array.from(value ?? [], Number);
}

export function toXt(r: any): Xt {
  return {
    xtHash: toHex(r.xt_hash)!,
    instanceId: toHex(r.instance_id)!,
    srcChain: numOrNull(r.src_chain),
    dstChain: numOrNull(r.dst_chain),
    chains: numberArray(r.chains),
    sender: toHex(r.sender),
    valueWei: r.value_wei != null ? String(r.value_wei) : null,
    status: r.status,
    stage: Number(r.stage),
    superblockNumber: numOrNull(r.superblock_number),
    firstSeenAt: toIso(r.first_seen_at),
    updatedAt: toIso(r.updated_at),
  };
}

export function toInstance(r: any): Instance {
  return {
    instanceId: toHex(r.instance_id)!,
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
