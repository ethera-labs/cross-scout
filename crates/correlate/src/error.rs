//! Correlation error type.

use cross_scout_store::StoreError;

/// Anything the correlation engine can fail with.
#[derive(Debug, thiserror::Error)]
pub enum CorrelateError {
    #[error(transparent)]
    Store(#[from] StoreError),
}

/// Convenience alias for correlation operations.
pub type CorrelateResult<T> = Result<T, CorrelateError>;
