//! Cross-chain correlation: the core of the indexer.
//!
//! [`lifecycle`] is the pure per-XT state machine; [`engine::Correlator`] wires
//! it to the store, joining events by `instance_id`/`session`, handling reorgs
//! and aborts, and publishing live deltas.

pub mod engine;
pub mod error;
pub mod lifecycle;

pub use engine::Correlator;
pub use error::{CorrelateError, CorrelateResult};
pub use lifecycle::{next_stage, Stage};
