//! Generic EVM log-polling source, shared by the EL, SBCP and settlement
//! ingesters. Each caller supplies a pure `decode` closure that turns a raw
//! `alloy` log into an optional [`DomainEvent`]; this module owns the provider,
//! the block cursor and backpressure onto the sink.

use std::time::Duration;

use alloy::primitives::{Address, B256};
use alloy::providers::{Provider, ProviderBuilder};
use alloy::rpc::types::{Filter, Log};
use cross_scout_types::{DomainEvent, EventMeta, EventSink, SinkClosed, SourceError};
use tracing::{debug, warn};

/// Static configuration for one polling source.
#[derive(Clone)]
pub struct PollConfig {
    pub name: &'static str,
    pub rpc_url: String,
    pub address: Address,
    pub chain_id: i32,
    pub start_block: u64,
    pub poll_ms: u64,
}

/// Build [`EventMeta`] from a raw log. `safe` is `false` only for flashblock
/// pre-confirmations; RPC logs are always from sealed blocks. Logs carry no
/// block timestamp, so observation time stands in for it.
pub fn meta_of(chain_id: i32, log: &Log, safe: bool) -> EventMeta {
    EventMeta {
        chain_id,
        block_number: log.block_number.unwrap_or_default() as i64,
        block_hash: log.block_hash.unwrap_or_default(),
        log_index: log.log_index.unwrap_or_default() as i32,
        tx_hash: log.transaction_hash,
        timestamp: chrono::Utc::now(),
        safe,
    }
}

/// `topics[0]`, the event signature hash matched against `SolEvent::SIGNATURE_HASH`.
pub fn topic0(log: &Log) -> Option<B256> {
    log.topics().first().copied()
}

/// Poll `address` for logs from `start_block` onward, decode each, and forward
/// onto `sink`. Runs until the sink closes.
///
/// # Errors
/// Returns [`SinkClosed`] once the correlation engine drops the receiver.
pub async fn poll_logs<F>(cfg: PollConfig, sink: EventSink, decode: F) -> Result<(), SourceError>
where
    F: Fn(i32, &Log) -> Option<DomainEvent> + Send + Sync,
{
    let provider = ProviderBuilder::new().connect_http(cfg.rpc_url.parse()?);
    let mut from = cfg.start_block;
    debug!(source = cfg.name, from, "starting log poller");

    loop {
        match provider.get_block_number().await {
            Ok(latest) if latest >= from => {
                let filter = Filter::new()
                    .address(cfg.address)
                    .from_block(from)
                    .to_block(latest);
                match provider.get_logs(&filter).await {
                    Ok(logs) => {
                        for log in &logs {
                            if let Some(ev) = decode(cfg.chain_id, log) {
                                sink.send(ev).await.map_err(|_| SinkClosed)?;
                            }
                        }
                        from = latest + 1;
                    }
                    Err(e) => warn!(source = cfg.name, error = %e, "get_logs failed; retrying"),
                }
            }
            Ok(_) => {}
            Err(e) => warn!(source = cfg.name, error = %e, "get_block_number failed; retrying"),
        }
        tokio::time::sleep(Duration::from_millis(cfg.poll_ms)).await;
    }
}
