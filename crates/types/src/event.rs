//! Normalized domain events.
//!
//! Each ingestion crate decodes its raw on-chain signals into a [`DomainEvent`]
//! - a [`EventMeta`] (provenance, for idempotency + reorg handling) plus an
//! [`EventKind`] (the decoded payload). The correlation engine consumes a
//! single ordered stream of these regardless of which source produced them.

use alloy::primitives::{Address, Bytes, B256, U256};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Where an event came from. `(chain_id, block_hash, log_index)` is the
/// idempotency key; `safe = false` marks a flashblock pre-confirmation that
/// can still be reorged away before its sealing block confirms.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EventMeta {
    pub chain_id: i32,
    pub block_number: i64,
    pub block_hash: B256,
    pub log_index: i32,
    pub tx_hash: Option<B256>,
    pub timestamp: DateTime<Utc>,
    pub safe: bool,
}

/// The decoded payload of an event, grouped by emitter family: mailbox, SBCP,
/// inclusion and settlement.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum EventKind {
    // ── ingress (Shared Publisher mempool) ────────────────────────
    XtRequested {
        xt_hash: B256,
        instance_id: B256,
        period: i64,
        seq: i32,
        src_chain: i32,
        dst_chain: i32,
        chains: Vec<i32>,
        sender: Address,
        value_wei: U256,
    },

    // ── SBCP / 2-phase commit ─────────────────────────────────────
    InstanceStarted {
        instance_id: B256,
        period: i64,
        seq: i32,
        chains: Vec<i32>,
        xt_hash: B256,
    },
    SequencerVoted {
        instance_id: B256,
        chain_id: i32,
        commit: bool,
    },
    InstanceDecided {
        instance_id: B256,
        commit: bool,
    },

    // ── mailbox (EL logs) ─────────────────────────────────────────
    MessageDispatched {
        id: B256,
        dst_chain_id: i32,
        session: B256,
        header: Bytes,
        body_hash: B256,
    },
    MessageDelivered {
        id: B256,
        src_chain_id: i32,
        session: B256,
    },
    OutboxRootUpdated {
        root: B256,
        index: i64,
    },
    InboxRootUpdated {
        root: B256,
        index: i64,
    },

    // ── inclusion (flashblocks + sealed blocks) ───────────────────
    Flashblock {
        chain_id: i32,
        xt_hash: B256,
        index: i32,
    },
    BlockSealed {
        chain_id: i32,
        number: i64,
        hash: B256,
        state_root: B256,
    },

    // ── superblock / settlement ───────────────────────────────────
    SuperblockProposed {
        number: i64,
        mailbox_root: B256,
        chains: Vec<i32>,
    },
    SuperblockValidated {
        number: i64,
        proof_id: B256,
    },
    SuperblockFinalized {
        number: i64,
        l1_tx: B256,
        l1_block: i64,
    },
}

/// A decoded event with full provenance.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DomainEvent {
    pub meta: EventMeta,
    #[serde(flatten)]
    pub kind: EventKind,
}

impl DomainEvent {
    pub fn new(meta: EventMeta, kind: EventKind) -> Self {
        Self { meta, kind }
    }

    /// The instance this event pertains to, if it names one.
    pub fn instance_id(&self) -> Option<B256> {
        match &self.kind {
            EventKind::XtRequested { instance_id, .. }
            | EventKind::InstanceStarted { instance_id, .. }
            | EventKind::SequencerVoted { instance_id, .. }
            | EventKind::InstanceDecided { instance_id, .. } => Some(*instance_id),
            _ => None,
        }
    }

    /// The XT this event pertains to, if it names one directly.
    pub fn xt_hash(&self) -> Option<B256> {
        match &self.kind {
            EventKind::XtRequested { xt_hash, .. }
            | EventKind::InstanceStarted { xt_hash, .. }
            | EventKind::Flashblock { xt_hash, .. } => Some(*xt_hash),
            _ => None,
        }
    }

    /// Stable discriminant string, stored in `raw_events.kind`.
    pub fn kind_tag(&self) -> &'static str {
        match &self.kind {
            EventKind::XtRequested { .. } => "xt_requested",
            EventKind::InstanceStarted { .. } => "instance_started",
            EventKind::SequencerVoted { .. } => "sequencer_voted",
            EventKind::InstanceDecided { .. } => "instance_decided",
            EventKind::MessageDispatched { .. } => "message_dispatched",
            EventKind::MessageDelivered { .. } => "message_delivered",
            EventKind::OutboxRootUpdated { .. } => "outbox_root_updated",
            EventKind::InboxRootUpdated { .. } => "inbox_root_updated",
            EventKind::Flashblock { .. } => "flashblock",
            EventKind::BlockSealed { .. } => "block_sealed",
            EventKind::SuperblockProposed { .. } => "superblock_proposed",
            EventKind::SuperblockValidated { .. } => "superblock_validated",
            EventKind::SuperblockFinalized { .. } => "superblock_finalized",
        }
    }
}
