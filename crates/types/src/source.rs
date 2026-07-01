//! The ingestion `Source` contract.
//!
//! Every `ingest-*` crate exposes one or more [`Source`]s. The runtime owns the
//! registry, spawns each source with a clone of the [`EventSink`], and funnels
//! the combined stream into the correlation engine.

use async_trait::async_trait;

use crate::event::DomainEvent;

/// The channel a source pushes decoded events onto. Bounded, so a slow
/// correlation engine applies backpressure to ingestion rather than growing an
/// unbounded queue.
pub type EventSink = tokio::sync::mpsc::Sender<DomainEvent>;

/// Error type a source run may fail with. Boxed so each ingester surfaces its
/// own transport/decode errors without the leaf crate depending on them.
pub type SourceError = Box<dyn std::error::Error + Send + Sync + 'static>;

/// Returned when the correlation engine has dropped the receiving end of the
/// [`EventSink`], meaning ingestion should stop.
#[derive(Debug, thiserror::Error)]
#[error("event sink closed")]
pub struct SinkClosed;

/// A long-running ingestion task.
///
/// `run` takes ownership of the source and drives it until the process shuts
/// down or it returns an error.
#[async_trait]
pub trait Source: Send + 'static {
    /// Stable identifier used in logs and the source registry.
    fn name(&self) -> &'static str;

    /// Drive ingestion, emitting [`DomainEvent`]s onto `sink`.
    async fn run(self: Box<Self>, sink: EventSink) -> Result<(), SourceError>;
}
