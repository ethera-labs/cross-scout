//! Runtime configuration, loaded from the environment (see `.env.example`).

use alloy::primitives::Address;
use std::env;

fn var(key: &str, default: &str) -> String {
    env::var(key).unwrap_or_else(|_| default.to_string())
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

/// Fully-resolved indexer configuration.
#[derive(Clone, Debug)]
pub struct Config {
    /// The rollup this instance lives inside; XTs are scoped to it.
    pub host_chain_id: i32,
    /// L1 chain id, used to stamp settlement events.
    pub l1_chain_id: i32,

    pub database_url: String,
    pub redis_url: String,

    /// op-reth EL RPC - mailbox + SBCP coordinator logs live here.
    pub el_rpc_url: String,
    /// op-rbuilder flashblocks websocket.
    pub flashblocks_ws_url: String,
    /// L1 settlement RPC.
    pub l1_rpc_url: String,

    pub mailbox_address: Address,
    pub sbcp_coordinator_address: Address,
    pub settlement_address: Address,

    pub el_start_block: u64,
    pub l1_start_block: u64,
    pub poll_interval_ms: u64,

    /// Drive the pipeline from synthetic in-memory sources (no rollup infra).
    pub use_mock_sources: bool,

    pub db_max_conns: u32,
}

impl Config {
    pub fn from_env() -> Self {
        Self {
            host_chain_id: parse("HOST_CHAIN_ID", 8453),
            l1_chain_id: parse("L1_CHAIN_ID", 1),
            database_url: var(
                "DATABASE_URL",
                "postgres://crossscout:crossscout@localhost:5432/crossscout",
            ),
            redis_url: var("REDIS_URL", "redis://localhost:6379"),
            el_rpc_url: var("EL_RPC_URL", "http://localhost:8545"),
            flashblocks_ws_url: var("FLASHBLOCKS_WS_URL", "ws://localhost:1111"),
            l1_rpc_url: var("L1_RPC_URL", "http://localhost:8546"),
            mailbox_address: addr("MAILBOX_ADDRESS"),
            sbcp_coordinator_address: addr("SBCP_COORDINATOR_ADDRESS"),
            settlement_address: addr("SETTLEMENT_ADDRESS"),
            el_start_block: parse("EL_START_BLOCK", 0),
            l1_start_block: parse("L1_START_BLOCK", 0),
            poll_interval_ms: parse("POLL_INTERVAL_MS", 1000),
            use_mock_sources: parse("USE_MOCK_SOURCES", true),
            db_max_conns: parse("DB_MAX_CONNS", 10),
        }
    }
}
