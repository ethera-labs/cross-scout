//! Redis pub/sub fan-out. The correlation engine publishes DTO deltas here; the
//! api subscribes to the same channel and forwards to WebSocket clients.

use cross_scout_types::StreamEvent;
use redis::aio::ConnectionManager;
use redis::AsyncCommands;

use crate::StoreResult;

/// The channel every live delta is published on. The api subscribes to it.
pub const STREAM_CHANNEL: &str = "crossscout:stream";

/// A cheap-to-clone publisher backed by a multiplexed connection manager that
/// transparently reconnects.
#[derive(Clone)]
pub struct RedisPublisher {
    conn: ConnectionManager,
    channel: String,
}

impl RedisPublisher {
    /// Connect to Redis and prepare a publisher for [`STREAM_CHANNEL`].
    ///
    /// # Errors
    /// Returns [`crate::StoreError::Redis`] if the connection cannot be opened.
    pub async fn connect(url: &str) -> StoreResult<Self> {
        let client = redis::Client::open(url)?;
        let conn = ConnectionManager::new(client).await?;
        Ok(Self {
            conn,
            channel: STREAM_CHANNEL.to_string(),
        })
    }

    /// Publish one stream delta as JSON. Fire-and-forget: a dropped live event
    /// never blocks canonical ingestion, since Postgres is the source of truth.
    ///
    /// # Errors
    /// Returns an error if serialization or the Redis `PUBLISH` fails.
    pub async fn publish(&self, ev: &StreamEvent) -> StoreResult<()> {
        let payload = serde_json::to_string(ev)?;
        let mut conn = self.conn.clone();
        let _: () = conn.publish(&self.channel, payload).await?;
        Ok(())
    }
}
