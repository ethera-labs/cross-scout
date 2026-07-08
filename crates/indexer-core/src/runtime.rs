//! The indexer runtime: connects the datastores, spawns the ingestion sources
//! onto a shared bounded channel, drains that channel through the correlation
//! engine, and runs the stall watchdog.

use std::time::Duration;

use cross_scout_correlate::Correlator;
use cross_scout_store::{Db, StreamNotifier};
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

        // Stream deltas ride the canonical pool as NOTIFY keys; the api
        // listens and rehydrates, so no separate broker is involved.
        let publisher = Some(StreamNotifier::new(db.pool.clone()));

        // Background workers write the store directly, so hand them a clone
        // before the correlator takes ownership of the pool.
        let worker_db = db.clone();
        let correlator = Correlator::new(db, publisher, cfg.stall_timeout_secs);

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

        // Token-metadata resolver: fills ERC-20 symbol/name/decimals for tokens
        // seen in transfers, off the RPCs already configured for ingestion.
        {
            let db = worker_db.clone();
            let cfg = cfg.clone();
            tokio::spawn(async move { crate::token_resolver::run(db, cfg).await });
        }

        // Publisher stats poller (only when a publisher URL is configured).
        if let Some(url) = cfg.publisher_url.clone() {
            info!(%url, "publisher stats polling enabled");
            let db = worker_db.clone();
            let poll_ms = cfg.poll_interval_ms;
            tokio::spawn(async move { crate::publisher_poll::run(db, url, poll_ms).await });
        }

        info!(host_chain = cfg.host_chain_id, "indexer running");

        while let Some(ev) = rx.recv().await {
            if let Err(e) = correlator.apply(ev).await {
                error!(error = %e, "apply failed");
            }
        }

        warn!("all sources ended; shutting down");
        Ok(())
    }
}
