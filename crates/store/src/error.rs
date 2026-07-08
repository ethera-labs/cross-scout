//! Storage error type.

/// Anything the canonical store can fail with.
#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error(transparent)]
    Database(#[from] sqlx::Error),

    #[error(transparent)]
    Migrate(#[from] sqlx::migrate::MigrateError),
}

/// Convenience alias for store operations.
pub type StoreResult<T> = Result<T, StoreError>;
