//! The CrossScout indexer runtime: configuration, the source registry, and
//! the scheduler that drains ingestion into correlation.

pub mod config;
pub mod error;
pub mod publisher_poll;
pub mod registry;
pub mod runtime;
pub mod token_resolver;

pub use config::Config;
pub use error::RuntimeError;
pub use runtime::Runtime;
