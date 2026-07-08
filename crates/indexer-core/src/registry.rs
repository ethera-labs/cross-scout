//! Source registry: assembles the set of ingestion [`Source`]s for this
//! instance from config - one EL poller (and optionally one flashblocks
//! stream) per participating rollup, plus the L1 settlement taps.

use alloy::primitives::Address;
use cross_scout_ingest_bridge::{
    L1PortalSource, L1PortalSourceConfig, L2BridgeSource, PortalEndpoint,
};
use cross_scout_ingest_el::ElSource;
use cross_scout_ingest_flashblocks::FlashblocksSource;
use cross_scout_ingest_settlement::{AnchorSource, SettlementSource, SettlementSourceConfig};
use cross_scout_types::Source;
use tracing::warn;

use crate::config::Config;

/// Build the ingestion sources for the given config.
pub fn build_sources(cfg: &Config) -> Vec<Box<dyn Source>> {
    let mut sources: Vec<Box<dyn Source>> = Vec::new();

    if cfg.el_rpc_urls.is_empty() {
        warn!("EL_RPC_URLS is empty - no rollup will be ingested");
    }
    if cfg.mailbox_address == Address::ZERO {
        warn!("MAILBOX_ADDRESS unset - mailbox logs will not decode");
    }

    // Mailbox + bridge logs on every participating rollup.
    for ep in &cfg.el_rpc_urls {
        sources.push(Box::new(ElSource::new(
            ep.chain_id,
            ep.url.clone(),
            cfg.mailbox_address,
            cfg.bridge_addresses.clone(),
            cfg.el_start_block,
            cfg.poll_interval_ms,
            cfg.log_max_range,
        )));
        sources.push(Box::new(L2BridgeSource::new(
            ep.chain_id,
            ep.url.clone(),
            cfg.el_start_block,
            cfg.poll_interval_ms,
            cfg.log_max_range,
        )));
    }

    // Flashblock pre-confirmations, where a builder websocket is exposed.
    for ep in &cfg.flashblocks_ws_urls {
        sources.push(Box::new(FlashblocksSource::new(
            ep.url.clone(),
            ep.chain_id,
            cfg.bridge_addresses.clone(),
        )));
    }

    // Superblock settlement on L1.
    if cfg.dispute_game_factory != Address::ZERO {
        sources.push(Box::new(SettlementSource::new(SettlementSourceConfig {
            l1_chain_id: cfg.l1_chain_id,
            l1_rpc_url: cfg.l1_rpc_url.clone(),
            factory: cfg.dispute_game_factory,
            game_type: cfg.game_type,
            allowed_chains: cfg
                .el_rpc_urls
                .iter()
                .map(|endpoint| endpoint.chain_id)
                .collect(),
            start_block: cfg.l1_start_block,
            poll_ms: cfg.poll_interval_ms,
            max_range: cfg.log_max_range,
        })));
    } else {
        warn!("DISPUTE_GAME_FACTORY_ADDRESS unset - superblock settlement will not be tracked");
    }
    if let Some(registry) = cfg.anchor_state_registry {
        sources.push(Box::new(AnchorSource::new(
            cfg.l1_chain_id,
            cfg.l1_rpc_url.clone(),
            registry,
            cfg.poll_interval_ms,
        )));
    }

    if cfg.portal_addresses.is_empty() {
        warn!("PORTAL_ADDRESSES unset - deposits and L1 withdrawal legs will not be tracked");
    } else {
        sources.push(Box::new(L1PortalSource::new(L1PortalSourceConfig {
            l1_chain_id: cfg.l1_chain_id,
            l1_rpc_url: cfg.l1_rpc_url.clone(),
            portals: cfg
                .portal_addresses
                .iter()
                .map(|endpoint| PortalEndpoint {
                    l2_chain_id: endpoint.chain_id,
                    address: endpoint.address,
                })
                .collect(),
            start_block: cfg.l1_start_block,
            poll_ms: cfg.poll_interval_ms,
            max_range: cfg.log_max_range,
        })));
    }

    sources
}
