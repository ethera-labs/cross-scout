//! `cross-scout-indexer` - the per-rollup indexer binary.

use cross_scout_indexer_core::{Config, Runtime};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let cfg = Config::from_env();
    Runtime::new(cfg).run().await?;
    Ok(())
}
