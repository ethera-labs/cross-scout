//! Wire types served by the api and exported to TypeScript via ts-rs.
//!
//! These are the canonical JSON shapes. Both the Rust side (Redis stream
//! publishes) and the Bun api (REST responses) produce exactly these, and the
//! TS SDK re-declares them. All byte values are `0x`-prefixed hex, all
//! timestamps are RFC-3339 strings, all chain ids are numbers.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Safety status of an XT, matching the `xts.status` column.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "generated/")]
#[serde(rename_all = "snake_case")]
pub enum XtStatus {
    Pending,
    Unsafe,
    Validated,
    Finalized,
    Failed,
}

/// Outcome of an SBCP 2-phase-commit instance.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "generated/")]
#[serde(rename_all = "snake_case")]
pub enum Decision {
    Pending,
    Commit,
    Abort,
}

/// Mailbox message direction relative to the host rollup.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "generated/")]
#[serde(rename_all = "snake_case")]
pub enum Direction {
    In,
    Out,
}

/// Settlement status of a superblock.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "generated/")]
#[serde(rename_all = "snake_case")]
pub enum SuperblockStatus {
    Proposed,
    Validated,
    Finalized,
}

/// One cross-chain transaction.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "generated/")]
#[serde(rename_all = "camelCase")]
pub struct Xt {
    pub xt_hash: String,
    pub instance_id: String,
    pub period: Option<i64>,
    pub seq: Option<i32>,
    pub src_chain: Option<i32>,
    pub dst_chain: Option<i32>,
    pub chains: Vec<i32>,
    pub sender: Option<String>,
    /// Decimal string (wei can exceed 2^53).
    pub value_wei: Option<String>,
    pub status: XtStatus,
    /// Lifecycle stage, 1..=9.
    pub stage: u8,
    pub superblock_number: Option<i64>,
    pub first_seen_at: String,
    pub updated_at: String,
}

/// A single sequencer's 2PC vote inside an instance.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "generated/")]
#[serde(rename_all = "camelCase")]
pub struct Vote {
    pub instance_id: String,
    pub chain_id: i32,
    pub commit: bool,
    pub voted_at: String,
}

/// An SBCP composability instance and its collected votes.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "generated/")]
#[serde(rename_all = "camelCase")]
pub struct Instance {
    pub instance_id: String,
    pub xt_hash: Option<String>,
    pub period: Option<i64>,
    pub seq: Option<i32>,
    pub participants: Vec<i32>,
    pub decision: Decision,
    pub started_at: Option<String>,
    pub decided_at: Option<String>,
    pub votes: Vec<Vote>,
}

/// A mailbox message crossing between rollups.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "generated/")]
#[serde(rename_all = "camelCase")]
pub struct MailboxMessage {
    pub id: i64,
    pub direction: Direction,
    pub src_chain: Option<i32>,
    pub dst_chain: Option<i32>,
    pub session: Option<String>,
    pub header: Option<String>,
    pub body_hash: Option<String>,
    pub xt_hash: Option<String>,
    pub superblock_number: Option<i64>,
    pub chain_id: i32,
    pub block_hash: String,
    pub log_index: i32,
    pub ts: String,
}

/// Per-chain state transition anchored in a superblock.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "generated/")]
#[serde(rename_all = "camelCase")]
pub struct SuperblockChain {
    pub superblock_number: i64,
    pub chain_id: i32,
    pub l2_block: Option<i64>,
    pub pre_root: Option<String>,
    pub post_root: Option<String>,
    pub config_hash: Option<String>,
}

/// A superblock plus its per-chain transitions.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "generated/")]
#[serde(rename_all = "camelCase")]
pub struct Superblock {
    pub number: i64,
    pub hash: Option<String>,
    pub parent_hash: Option<String>,
    pub period: Option<i64>,
    pub status: SuperblockStatus,
    pub mailbox_root: Option<String>,
    pub xt_count: i32,
    pub prove_ms: Option<i32>,
    pub l1_tx: Option<String>,
    pub l1_block: Option<i64>,
    pub proposed_at: Option<String>,
    pub validated_at: Option<String>,
    pub finalized_at: Option<String>,
    pub chains: Vec<SuperblockChain>,
}

/// The joined view returned by `GET /v1/xts/:hash`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "generated/")]
#[serde(rename_all = "camelCase")]
pub struct XtDetail {
    pub xt: Xt,
    pub instance: Option<Instance>,
    pub mailbox: Vec<MailboxMessage>,
    pub superblock: Option<Superblock>,
}

/// Volume between an ordered rollup pair, for the Sankey view.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "generated/")]
#[serde(rename_all = "camelCase")]
pub struct RouteVolume {
    pub src_chain: i32,
    pub dst_chain: i32,
    pub count: i64,
    pub value_wei: String,
}

/// Network-wide totals for `GET /v1/stats`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "generated/")]
#[serde(rename_all = "camelCase")]
pub struct NetworkStats {
    pub host_chain: i32,
    pub total_xts: i64,
    pub pending: i64,
    pub validated: i64,
    pub finalized: i64,
    pub failed: i64,
    pub superblocks: i64,
    pub avg_prove_ms: Option<f64>,
    pub routes: Vec<RouteVolume>,
}

/// A page of XTs.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "generated/")]
#[serde(rename_all = "camelCase")]
pub struct XtPage {
    pub items: Vec<Xt>,
    pub next_cursor: Option<String>,
}

/// Events pushed over `WS /v1/stream`. Serialized internally-tagged so the TS
/// client can switch on `type`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "generated/")]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum StreamEvent {
    /// A previously-unseen XT was created.
    NewXt { xt: Xt },
    /// An existing XT advanced (stage/status/superblock changed).
    XtUpdated { xt: Xt },
    /// A sequencer vote landed.
    Vote { vote: Vote },
    /// A superblock changed settlement status.
    SuperblockUpdated { superblock: Superblock },
}
