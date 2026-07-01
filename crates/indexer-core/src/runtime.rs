//! The indexer runtime: connects the datastores, spawns the ingestion sources
//! onto a shared bounded channel, drains that channel through the correlation
//! engine, and runs the stall watchdog.

use std::time::Duration;

use cross_scout_correlate::Correlator;
use cross_scout_store::{Db, RedisPublisher};
use cross_scout_types::DomainEvent;
use tokio::sync::mpsc;
use tracing::{error, info, warn};

use crate::config::Config;
use crate::error::RuntimeError;
use crate::registry::build_sources;

/// Owns the wiring between sources, correlation and storage.
pub struct Runtime {
    cfg: Config,
}

impl Runtime {
    pub fn new(cfg: Config) -> Self {
        Self { cfg }
    }

    /// Run the indexer until every ingestion source has ended.
    ///
    /// # Errors
    /// Returns [`RuntimeError`] if the store cannot be connected or migrated.
    pub async fn run(self) -> Result<(), RuntimeError> {
        let cfg = self.cfg;

        let db = Db::connect(&cfg.database_url, cfg.db_max_conns).await?;
        db.migrate().await?;
        info!("migrations applied");

        let publisher = match RedisPublisher::connect(&cfg.redis_url).await {
            Ok(p) => {
                info!("redis connected - live stream enabled");
                Some(p)
            }
            Err(e) => {
                warn!(error = %e, "redis unavailable - live stream disabled");
                None
            }
        };

        let correlator = Correlator::new(db, publisher, cfg.host_chain_id);

        // Bounded so a slow correlator applies backpressure to ingestion.
        let (tx, mut rx) = mpsc::channel::<DomainEvent>(2048);

        for src in build_sources(&cfg) {
            let tx = tx.clone();
            let name = src.name();
            tokio::spawn(async move {
                info!(source = name, "source started");
                if let Err(e) = src.run(tx).await {
                    error!(source = name, error = %e, "source exited");
                }
            });
        }
        drop(tx); // rx closes once every source has ended

        // Stall watchdog.
        {
            let c = correlator.clone();
            tokio::spawn(async move {
                let mut ticker = tokio::time::interval(Duration::from_secs(60));
                loop {
                    ticker.tick().await;
                    if let Err(e) = c.sweep_stalled().await {
                        warn!(error = %e, "watchdog failed");
                    }
                }
            });
        }

        info!(
            host_chain = cfg.host_chain_id,
            mock = cfg.use_mock_sources,
            "indexer running"
        );

        while let Some(ev) = rx.recv().await {
            if let Err(e) = correlator.apply(ev).await {
                error!(error = %e, "apply failed");
            }
        }

        warn!("all sources ended; shutting down");
        Ok(())
    }
}
