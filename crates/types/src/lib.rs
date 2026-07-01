//! Shared domain contracts for the CrossScout indexer.
//!
//! Three things live here, all leaf-level so every other crate can depend on
//! them without a cycle:
//!
//! * [`dto`] - the wire types served by the api and exported to TypeScript via
//!   `ts-rs`. Hashes/addresses are hex strings, timestamps are RFC-3339.
//! * [`event`] - the normalized [`DomainEvent`]s the ingestion crates emit and
//!   the correlation engine consumes. These keep native `alloy` primitives.
//! * [`source`] - the [`Source`] trait every ingestion crate implements plus
//!   the channel type the runtime wires them onto.

pub mod dto;
pub mod event;
pub mod source;

pub use dto::*;
pub use event::{DomainEvent, EventKind, EventMeta};
pub use source::{EventSink, SinkClosed, Source, SourceError};

/// SBCP period length in seconds. The correlation watchdog flags any XT that
/// has not reached a decision within one period of `first_seen_at`.
pub const PERIOD_SECONDS: i64 = 3840;

/// Lifecycle stage of a cross-chain transaction: 1..=9 plus the terminal
/// `RolledBack`. The `xts.stage` column stores the numeric discriminant.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize, ts_rs::TS)]
#[ts(export, export_to = "generated/")]
#[serde(rename_all = "snake_case")]
#[repr(u8)]
pub enum Stage {
    Requested = 1,
    Scheduled = 2,
    Simulating = 3,
    Voting = 4,
    Decided = 5,
    Included = 6,
    Settled = 7,
    Validated = 8,
    Finalized = 9,
    RolledBack = 255,
}

impl Stage {
    /// Numeric discriminant persisted in `xts.stage`.
    pub fn as_u8(self) -> u8 {
        self as u8
    }

    /// Reconstruct a stage from its persisted discriminant.
    pub fn from_u8(n: u8) -> Option<Stage> {
        Some(match n {
            1 => Stage::Requested,
            2 => Stage::Scheduled,
            3 => Stage::Simulating,
            4 => Stage::Voting,
            5 => Stage::Decided,
            6 => Stage::Included,
            7 => Stage::Settled,
            8 => Stage::Validated,
            9 => Stage::Finalized,
            255 => Stage::RolledBack,
            _ => return None,
        })
    }

    /// The safety `status` a given stage maps onto for the `xts.status` column.
    pub fn status(self) -> XtStatus {
        match self {
            Stage::RolledBack => XtStatus::Failed,
            Stage::Finalized => XtStatus::Finalized,
            Stage::Validated => XtStatus::Validated,
            Stage::Included | Stage::Settled => XtStatus::Unsafe,
            _ => XtStatus::Pending,
        }
    }
}
