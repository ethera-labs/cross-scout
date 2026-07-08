//! Runtime configuration, loaded from the environment (see `.env.example`).

use alloy::primitives::Address;
use std::env;

fn var(key: &str, default: &str) -> String {
    env::var(key).unwrap_or_else(|_| default.to_string())
}

/// A set, non-empty env var, else `None`.
fn opt_var(key: &str) -> Option<String> {
    env::var(key).ok().filter(|v| !v.trim().is_empty())
}

fn parse<T: std::str::FromStr>(key: &str, default: T) -> T {
    env::var(key)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

fn addr(key: &str) -> Address {
    env::var(key)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(Address::ZERO)
}

fn opt_addr(key: &str) -> Option<Address> {
    env::var(key).ok().and_then(|v| v.parse().ok())
}

/// Comma-separated `0x…` addresses.
fn addr_list(key: &str) -> Vec<Address> {
    env::var(key)
        .unwrap_or_default()
        .split(',')
        .filter_map(|s| s.trim().parse().ok())
        .collect()
}

/// `latest` (or empty) starts at the current head; a number backfills from it.
fn start_block(key: &str) -> Option<u64> {
    match env::var(key) {
        Ok(v) if !v.trim().is_empty() && v.trim() != "latest" => v.trim().parse().ok(),
        _ => None,
    }
}

/// One `chain_id=url` endpoint.
#[derive(Clone, Debug)]
pub struct ChainEndpoint {
    pub chain_id: i32,
    pub url: String,
}

/// One `chain_id=address` endpoint.
#[derive(Clone, Debug)]
pub struct ChainAddress {
    pub chain_id: i32,
    pub address: Address,
}

/// Comma-separated `<chain_id>=<url>` pairs, one per participating rollup.
fn endpoint_list(key: &str) -> Vec<ChainEndpoint> {
    env::var(key)
        .unwrap_or_default()
        .split(',')
        .filter_map(|pair| {
            let (chain, url) = pair.trim().split_once('=')?;
            Some(ChainEndpoint {
                chain_id: chain.trim().parse().ok()?,
                url: url.trim().to_string(),
            })
        })
        .collect()
}

/// Comma-separated `<chain_id>=<0xaddress>` pairs.
fn chain_address_list(key: &str) -> Vec<ChainAddress> {
    env::var(key)
        .unwrap_or_default()
        .split(',')
        .filter_map(|pair| {
            let (chain, address) = pair.trim().split_once('=')?;
            Some(ChainAddress {
                chain_id: chain.trim().parse().ok()?,
                address: address.trim().parse().ok()?,
            })
        })
        .collect()
}

/// Fully-resolved indexer configuration.
#[derive(Clone, Debug)]
pub struct Config {
    /// The rollup this instance lives inside; XTs are scoped to it.
    pub host_chain_id: i32,
    /// L1 chain id, used to stamp settlement events.
    pub l1_chain_id: i32,

    pub database_url: String,

    /// Per-rollup execution RPCs (host + counterparties) - mailbox and bridge
    /// logs are polled on every listed chain so both legs of a session are
    /// observed.
    pub el_rpc_urls: Vec<ChainEndpoint>,
    /// Per-rollup op-rbuilder flashblocks websockets. Optional: without them
    /// the indexer still sees everything, just without pre-confirmations.
    pub flashblocks_ws_urls: Vec<ChainEndpoint>,
    /// L1 settlement RPC.
    pub l1_rpc_url: String,
    /// Publisher (coordinator) base URL. When set, its `/stats` endpoint is
    /// polled for period + liveness telemetry; unset disables that poller.
    pub publisher_url: Option<String>,

    /// `UniversalBridgeMailbox`, deployed at the same address on every rollup.
    pub mailbox_address: Address,
    /// `ComposeL2ToL2Bridge` (and any additional authorized bridges).
    pub bridge_addresses: Vec<Address>,
    /// L1 `DisputeGameFactory` the publisher settles superblocks through.
    pub dispute_game_factory: Address,
    /// L1 `ComposeAnchorStateRegistry`; unset disables finalization tracking.
    pub anchor_state_registry: Option<Address>,
    /// Per-rollup L1 `OptimismPortal` proxies used for deposits and L1
    /// withdrawal lifecycle events.
    pub portal_addresses: Vec<ChainAddress>,
    /// Compose dispute game type (publisher's `COMPOSE_GAME_TYPE`).
    pub game_type: u32,

    /// `None` starts ingestion at the current head (`EL_START_BLOCK=latest`).
    pub el_start_block: Option<u64>,
    pub l1_start_block: Option<u64>,
    pub poll_interval_ms: u64,
    /// Max blocks per `eth_getLogs` call.
    pub log_max_range: u64,
    /// Seconds before an XT without a sealed inclusion is rolled back.
    pub stall_timeout_secs: i64,

    pub db_max_conns: u32,
}

impl Config {
    pub fn from_env() -> Self {
        Self {
            host_chain_id: parse("HOST_CHAIN_ID", 0),
            l1_chain_id: parse("L1_CHAIN_ID", 1),
            database_url: var(
                "DATABASE_URL",
                "postgres://crossscout:crossscout@localhost:5432/crossscout",
            ),
            el_rpc_urls: endpoint_list("EL_RPC_URLS"),
            flashblocks_ws_urls: endpoint_list("FLASHBLOCKS_WS_URLS"),
            l1_rpc_url: var("L1_RPC_URL", "http://localhost:8546"),
            publisher_url: opt_var("PUBLISHER_URL"),
            mailbox_address: addr("MAILBOX_ADDRESS"),
            bridge_addresses: addr_list("BRIDGE_ADDRESSES"),
            dispute_game_factory: addr("DISPUTE_GAME_FACTORY_ADDRESS"),
            anchor_state_registry: opt_addr("ANCHOR_STATE_REGISTRY_ADDRESS"),
            portal_addresses: chain_address_list("PORTAL_ADDRESSES"),
            game_type: parse("COMPOSE_GAME_TYPE", 5555),
            el_start_block: start_block("EL_START_BLOCK"),
            l1_start_block: start_block("L1_START_BLOCK"),
            poll_interval_ms: parse("POLL_INTERVAL_MS", 1000),
            log_max_range: parse("LOG_MAX_RANGE", 5000),
            stall_timeout_secs: parse("STALL_TIMEOUT_SECONDS", cross_scout_types::PERIOD_SECONDS),
            db_max_conns: parse("DB_MAX_CONNS", 10),
        }
    }
}
