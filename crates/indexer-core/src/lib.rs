//! The CrossScout indexer runtime: configuration, the source registry, the
//! scheduler that drains ingestion into correlation, and the synthetic mock
//! source used for infra-free local runs.

pub mod config;
pub mod error;
pub mod mock;
pub mod registry;
pub mod runtime;

pub use config::Config;
pub use error::RuntimeError;
pub use runtime::Runtime;
