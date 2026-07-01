//! Runtime error type.

use cross_scout_correlate::CorrelateError;
use cross_scout_store::StoreError;

/// Anything the indexer runtime can fail with during startup or teardown.
#[derive(Debug, thiserror::Error)]
pub enum RuntimeError {
    #[error(transparent)]
    Store(#[from] StoreError),

    #[error(transparent)]
    Correlate(#[from] CorrelateError),
}
