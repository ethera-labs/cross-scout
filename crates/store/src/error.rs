//! Storage error type.

/// Anything the canonical store or the Redis publisher can fail with.
#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error(transparent)]
    Database(#[from] sqlx::Error),

    #[error(transparent)]
    Migrate(#[from] sqlx::migrate::MigrateError),

    #[error(transparent)]
    Redis(#[from] redis::RedisError),

    #[error(transparent)]
    Serialize(#[from] serde_json::Error),
}

/// Convenience alias for store operations.
pub type StoreResult<T> = Result<T, StoreError>;
