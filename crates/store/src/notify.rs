//! Live-stream fan-out over Postgres `NOTIFY`. The engine publishes a compact
//! row key per delta; the api `LISTEN`s on the channel, rehydrates the row and
//! forwards the DTO to WebSocket clients. Keys instead of payloads keep every
//! notification far under the `NOTIFY` size cap and guarantee the stream only
//! ever reflects committed rows.

use alloy::primitives::B256;
use sqlx::PgPool;

use crate::convert::hex_prefixed;
use crate::StoreResult;

/// The `NOTIFY` channel the api listens on.
pub const STREAM_CHANNEL: &str = "crossscout_stream";

/// One stream delta: which row changed and how to announce it.
#[derive(Debug, Clone, Copy)]
pub enum StreamKey<'a> {
    NewXt(&'a B256),
    XtUpdated(&'a B256),
    SuperblockUpdated(i64),
}

impl StreamKey<'_> {
    /// Compact JSON the listener maps back to a row fetch. `kind` mirrors the
    /// wire `StreamEvent` tag so the api forwards it unchanged.
    fn payload(&self) -> String {
        match self {
            Self::NewXt(h) => {
                format!(r#"{{"kind":"newXt","id":"{}"}}"#, hex_prefixed(h.as_slice()))
            }
            Self::XtUpdated(h) => {
                format!(
                    r#"{{"kind":"xtUpdated","id":"{}"}}"#,
                    hex_prefixed(h.as_slice())
                )
            }
            Self::SuperblockUpdated(n) => {
                format!(r#"{{"kind":"superblockUpdated","id":"{n}"}}"#)
            }
        }
    }
}

/// Cheap-to-clone notifier sharing the canonical pool: one notification is a
/// single `pg_notify` round-trip, fire-and-forget for ingestion.
#[derive(Clone)]
pub struct StreamNotifier {
    pool: PgPool,
}

impl StreamNotifier {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Publish one stream delta key.
    ///
    /// # Errors
    /// Returns [`StoreError::Database`](crate::StoreError::Database) if the
    /// `pg_notify` call fails.
    pub async fn publish(&self, key: StreamKey<'_>) -> StoreResult<()> {
        sqlx::query("select pg_notify($1, $2)")
            .bind(STREAM_CHANNEL)
            .bind(key.payload())
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}
