//! Postgres (canonical) + Redis (live fan-out) persistence for the indexer.
//!
//! The correlation engine drives everything through [`Db`]: it records each raw
//! event idempotently, upserts the canonical rows, and publishes the resulting
//! DTO deltas onto Redis via [`RedisPublisher`] for the api to fan out over
//! WebSocket.

pub mod convert;
pub mod error;
pub mod redis;
pub mod repo;
pub mod rows;

pub use error::{StoreError, StoreResult};
pub use redis::RedisPublisher;

use std::time::Duration;

use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;

/// A connection pool to the canonical Postgres store.
#[derive(Clone)]
pub struct Db {
    pub pool: PgPool,
}

impl Db {
    /// Open a pool. `max_conns` bounds concurrency between the ingestion
    /// writers and the api readers when they share a database in dev.
    ///
    /// # Errors
    /// Returns [`StoreError::Database`] if the connection cannot be established.
    pub async fn connect(url: &str, max_conns: u32) -> StoreResult<Self> {
        let pool = PgPoolOptions::new()
            .max_connections(max_conns)
            .acquire_timeout(Duration::from_secs(10))
            .connect(url)
            .await?;
        Ok(Self { pool })
    }

    /// Apply the SQL migrations embedded from `/migrations` at build time.
    ///
    /// # Errors
    /// Returns [`StoreError::Migrate`] if a migration fails to apply.
    pub async fn migrate(&self) -> StoreResult<()> {
        sqlx::migrate!("../../migrations").run(&self.pool).await?;
        Ok(())
    }
}
