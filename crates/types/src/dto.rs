//! Wire types served by the api and exported to TypeScript via ts-rs.
//!
//! These are the canonical JSON shapes. Both the Rust side (Redis stream
//! publishes) and the Bun api (REST responses) produce exactly these, and the
//! TS SDK re-declares them. All byte values are `0x`-prefixed hex, all
//! timestamps are RFC-3339 strings, all chain ids are numbers.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// User-facing lifecycle status of an XT.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "generated/")]
#[serde(rename_all = "snake_case")]
pub enum XtStatus {
    Pending,
    Committed,
    Validated,
    Finalized,
    Failed,
}

/// Outcome of a cross-chain session. Derived from observable effects: a
/// mailbox write in a sealed block commits the session; a pre-confirmation
/// that never seals within the stall window aborts it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "generated/")]
#[serde(rename_all = "snake_case")]
pub enum Decision {
    Pending,
    Commit,
    Abort,
}

/// Mailbox message direction relative to the chain it was observed on:
/// `out` is an outbox write (message leaving), `in` an inbox write.
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

/// Execution fee paid by an observed EVM transaction.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "generated/")]
#[serde(rename_all = "camelCase")]
pub struct TxFee {
    pub gas_used: String,
    pub effective_gas_price_wei: String,
    pub fee_wei: String,
    pub fee_usd: Option<String>,
}

/// One cross-chain transaction, keyed by its mailbox session.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "generated/")]
#[serde(rename_all = "camelCase")]
pub struct Xt {
    pub xt_hash: String,
    pub src_chain: Option<i32>,
    pub dst_chain: Option<i32>,
    pub chains: Vec<i32>,
    pub sender: Option<String>,
    pub receiver: Option<String>,
    pub label: Option<String>,
    /// Native-ETH value in wei, decimal string (wei can exceed 2^53). Token
    /// transfers never populate this - their amounts live on `Transfer`.
    pub value_wei: Option<String>,
    pub value_usd: Option<String>,
    pub status: XtStatus,
    /// Lifecycle stage, 1..=9 or the terminal 255.
    pub stage: u8,
    pub superblock_number: Option<i64>,
    /// Originating bridge call on the source rollup.
    pub src_tx_hash: Option<String>,
    pub first_seen_at: String,
    pub preconfirmed_at: Option<String>,
    pub included_at: Option<String>,
    pub settled_at: Option<String>,
    pub finalized_at: Option<String>,
    pub failed_at: Option<String>,
    pub updated_at: String,
}

/// A cross-chain session and its derived decision, keyed by the mailbox
/// session id (the only cross-chain identity observable on-chain).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "generated/")]
#[serde(rename_all = "camelCase")]
pub struct Instance {
    pub session: String,
    pub xt_hash: Option<String>,
    pub participants: Vec<i32>,
    pub decision: Decision,
    pub started_at: Option<String>,
    pub decided_at: Option<String>,
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
    pub sender: Option<String>,
    pub receiver: Option<String>,
    pub label: Option<String>,
    pub xt_hash: Option<String>,
    pub superblock_number: Option<i64>,
    pub chain_id: i32,
    pub block_hash: String,
    pub log_index: i32,
    pub tx_hash: Option<String>,
    pub tx_fee: Option<TxFee>,
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
    pub status: SuperblockStatus,
    /// Super-root claim the settlement dispute game was created with.
    pub root_claim: Option<String>,
    /// The dispute game proxy the factory created for this superblock.
    pub game_address: Option<String>,
    pub xt_count: i32,
    pub prove_ms: Option<i32>,
    pub l1_tx: Option<String>,
    pub l1_block: Option<i64>,
    pub l1_tx_fee: Option<TxFee>,
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
    pub transfers: Vec<Transfer>,
    /// Metadata for every token referenced by `transfers`.
    pub tokens: Vec<TokenMeta>,
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
    pub transfers: i64,
}

/// Network-wide totals for `GET /v1/stats`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "generated/")]
#[serde(rename_all = "camelCase")]
pub struct NetworkStats {
    pub host_chain: i32,
    pub total_xts: i64,
    pub pending: i64,
    pub committed: i64,
    pub validated: i64,
    pub finalized: i64,
    pub failed: i64,
    pub superblocks: i64,
    pub avg_prove_ms: Option<f64>,
    pub routes: Vec<RouteVolume>,
    pub window24h: StatsWindow,
    /// Fraction of decided instances that committed, over all time. `None`
    /// until at least one instance has reached a decision.
    pub commit_rate: Option<f64>,
    pub last_finalized_superblock: Option<i64>,
}

/// A page of XTs.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "generated/")]
#[serde(rename_all = "camelCase")]
pub struct XtPage {
    pub items: Vec<Xt>,
    pub next_cursor: Option<String>,
}

/// A source-leg asset transfer (one `ETHBridged` / `TokensSendQueued`),
/// observed on the source rollup only so it counts once network-wide.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "generated/")]
#[serde(rename_all = "camelCase")]
pub struct Transfer {
    pub id: i64,
    pub session: String,
    /// `eth` for native transfers, `erc20` for token transfers.
    pub kind: String,
    /// Token address for `erc20`, absent for native ETH.
    pub token: Option<String>,
    /// Raw base-unit amount (token decimals in `TokenMeta`), decimal string.
    pub amount: String,
    pub amount_usd: Option<String>,
    pub src_chain: i32,
    pub dst_chain: i32,
    pub sender: String,
    pub receiver: String,
    pub message_id: Option<String>,
    pub chain_id: i32,
    pub tx_hash: Option<String>,
    /// `false` while only a flashblock pre-confirmation has been seen.
    pub safe: bool,
    pub ts: String,
}

/// Resolved (or pending) ERC-20 metadata for a token seen in a transfer.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "generated/")]
#[serde(rename_all = "camelCase")]
pub struct TokenMeta {
    pub chain_id: i32,
    pub address: String,
    pub symbol: Option<String>,
    pub name: Option<String>,
    pub decimals: Option<i32>,
}

/// Aggregate counts over a rolling time window.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "generated/")]
#[serde(rename_all = "camelCase")]
pub struct StatsWindow {
    pub xts: i64,
    pub transfers: i64,
    /// Native-ETH volume over the window, wei, decimal string.
    pub volume_wei: String,
    pub messages: i64,
}

/// One time-bucketed activity point for the overview timeseries.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "generated/")]
#[serde(rename_all = "camelCase")]
pub struct ActivityPoint {
    /// Bucket start, RFC-3339.
    pub bucket: String,
    pub count: i64,
    /// Native-ETH volume in the bucket, wei, decimal string.
    pub volume_wei: String,
    pub transfers: i64,
}

/// Transfer volume for one asset, aggregated across the chains it moved on.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "generated/")]
#[serde(rename_all = "camelCase")]
pub struct AssetVolume {
    /// Absent for native ETH.
    pub token: Option<TokenMeta>,
    pub transfers: i64,
    /// Summed raw base-unit amount, decimal string.
    pub amount: String,
    pub chains: Vec<i32>,
}

/// One sampled point of the publisher's coordinator liveness series.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "generated/")]
#[serde(rename_all = "camelCase")]
pub struct PublisherSnapshot {
    pub ts: String,
    pub period_id: i64,
    pub next_superblock: i64,
    pub last_finalized: i64,
    pub queued: i32,
    pub active_xts: i32,
    pub active_chains: i32,
    pub connections: i32,
    pub registered_chains: i32,
    pub pending_proofs: i32,
}

/// An observed SBCP period and when it was first/last seen.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "generated/")]
#[serde(rename_all = "camelCase")]
pub struct PeriodInfo {
    pub period_id: i64,
    pub superblock_number: Option<i64>,
    pub first_seen_at: String,
    pub last_seen_at: String,
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
    /// A superblock changed settlement status.
    SuperblockUpdated { superblock: Superblock },
}
