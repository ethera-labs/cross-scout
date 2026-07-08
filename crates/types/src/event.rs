//! Normalized domain events.
//!
//! Each ingestion crate decodes its raw on-chain signals into a
//! [`DomainEvent`]: a [`EventMeta`] (provenance, for idempotency + reorg
//! handling) plus an [`EventKind`] (the decoded payload). The correlation
//! engine consumes a single ordered stream of these regardless of which
//! source produced them.
//!
//! The cross-chain session id (`bytes32`-widened `sessionId` from the mailbox
//! headers) is the on-chain identity of an XT: every signal that belongs to
//! the same XT carries the same session, and the engine joins on it.

use alloy::primitives::{Address, B256, U256};
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
    pub gas_used: Option<U256>,
    pub effective_gas_price_wei: Option<U256>,
    pub timestamp: DateTime<Utc>,
    pub safe: bool,
}

/// One rollup's state transition inside a superblock, decoded from the
/// publisher's dispute-game `extraData` (`BootInfo` + super-root output).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChainTransition {
    pub chain_id: i32,
    pub l2_block: i64,
    pub pre_root: B256,
    pub post_root: B256,
    pub config_hash: B256,
}

/// The decoded payload of an event, grouped by emitter family: bridge
/// ingress, mailbox, inclusion and L1 settlement.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum EventKind {
    // ── ingress (bridge call carrying a session) ──────────────────
    /// A cross-chain bridge call was observed - either pre-confirmed in a
    /// flashblock (`meta.safe = false`) or emitted by a sealed bridge log.
    /// `asset = None` is a native-ETH transfer; `Some` is an ERC-20 whose
    /// `amount` is denominated in the token's base units, not wei.
    XtRequested {
        session: B256,
        src_chain: i32,
        dst_chain: i32,
        sender: Address,
        receiver: Address,
        asset: Option<Address>,
        amount: U256,
        message_id: Option<B256>,
    },

    // ── mailbox (UniversalBridgeMailbox logs + header lookups) ────
    /// `NewOutboxKey` on the source rollup: the message left its outbox.
    MessageDispatched {
        key: B256,
        session: B256,
        src_chain: i32,
        dst_chain: i32,
        sender: Address,
        receiver: Address,
        label: String,
    },
    /// `NewInboxKey` on the destination rollup: the message reached its inbox.
    MessageDelivered {
        key: B256,
        session: B256,
        src_chain: i32,
        dst_chain: i32,
        sender: Address,
        receiver: Address,
        label: String,
    },

    // ── inclusion (sealed heads) ──────────────────────────────────
    BlockSealed {
        chain_id: i32,
        number: i64,
        hash: B256,
        parent_hash: B256,
        state_root: B256,
    },

    // ── superblock / settlement (L1 dispute games) ────────────────
    /// `DisputeGameCreated` for the compose game type: the publisher settled
    /// a superblock on L1.
    SuperblockProposed {
        number: i64,
        /// Super-root claim the game was created with.
        root_claim: B256,
        /// keccak of the ABI-encoded aggregation outputs - the superblock
        /// batch hash the next superblock references as its parent.
        hash: B256,
        parent_hash: B256,
        /// The dispute game proxy the factory created for this superblock.
        game_address: Address,
        chains: Vec<i32>,
        transitions: Vec<ChainTransition>,
    },
    /// The compose anchor state registry advanced to (or past) this
    /// superblock: its game resolved and the anchor was accepted.
    SuperblockFinalized { number: i64, anchor_root: B256 },
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

    /// The session (== XT identity) this event pertains to, if it names one.
    pub fn session(&self) -> Option<B256> {
        match &self.kind {
            EventKind::XtRequested { session, .. }
            | EventKind::MessageDispatched { session, .. }
            | EventKind::MessageDelivered { session, .. } => Some(*session),
            _ => None,
        }
    }

    /// Stable discriminant string, stored in `raw_events.kind`.
    pub fn kind_tag(&self) -> &'static str {
        match &self.kind {
            EventKind::XtRequested { .. } => "xt_requested",
            EventKind::MessageDispatched { .. } => "message_dispatched",
            EventKind::MessageDelivered { .. } => "message_delivered",
            EventKind::BlockSealed { .. } => "block_sealed",
            EventKind::SuperblockProposed { .. } => "superblock_proposed",
            EventKind::SuperblockFinalized { .. } => "superblock_finalized",
        }
    }
}
