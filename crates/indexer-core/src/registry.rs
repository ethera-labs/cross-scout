//! Source registry: assembles the set of ingestion [`Source`]s for this
//! instance from config - either the synthetic mock source or the live
//! per-rollup taps.

use crate::config::Config;
use crate::mock::MockSource;
use cross_scout_ingest_el::ElSource;
use cross_scout_ingest_flashblocks::FlashblocksSource;
use cross_scout_ingest_sbcp::SbcpSource;
use cross_scout_ingest_settlement::SettlementSource;
use cross_scout_types::Source;

/// Build the ingestion sources for the given config.
pub fn build_sources(cfg: &Config) -> Vec<Box<dyn Source>> {
    if cfg.use_mock_sources {
        return vec![Box::new(MockSource::new(cfg.host_chain_id))];
    }

    vec![
        // Mailbox logs on the host rollup's EL.
        Box::new(ElSource::new(
            cfg.el_rpc_url.clone(),
            cfg.mailbox_address,
            cfg.host_chain_id,
            cfg.el_start_block,
            cfg.poll_interval_ms,
        )),
        // SBCP coordinator (2PC) logs, also on the host EL.
        Box::new(SbcpSource::new(
            cfg.el_rpc_url.clone(),
            cfg.sbcp_coordinator_address,
            cfg.host_chain_id,
            cfg.el_start_block,
            cfg.poll_interval_ms,
        )),
        // Superblock lifecycle on L1.
        Box::new(SettlementSource::new(
            cfg.l1_rpc_url.clone(),
            cfg.settlement_address,
            cfg.l1_chain_id,
            cfg.l1_start_block,
            cfg.poll_interval_ms,
        )),
        // Flashblock pre-confirmations over websocket.
        Box::new(FlashblocksSource::new(
            cfg.flashblocks_ws_url.clone(),
            cfg.host_chain_id,
        )),
    ]
}
