//! Postgres persistence for the indexer: canonical rows plus the live-stream
//! fan-out.
//!
//! The correlation engine drives everything through [`Db`]: it records each raw
//! event idempotently, upserts the canonical rows, and announces each delta as
//! a compact key on a `NOTIFY` channel via [`StreamNotifier`] for the api to
//! rehydrate and fan out over WebSocket.

pub mod convert;
pub mod error;
pub mod notify;
pub mod repo;
pub mod rows;
pub mod write;

pub use error::{StoreError, StoreResult};
pub use notify::{StreamKey, StreamNotifier};

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
    /// writers and the api readers when they share a database.
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
