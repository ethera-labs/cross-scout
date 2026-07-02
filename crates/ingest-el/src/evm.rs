//! Generic EVM log-polling source, shared by the EL and settlement ingesters.
//! Each caller supplies an async [`LogDecoder`] that turns a raw `alloy` log
//! into domain events (and may issue follow-up provider calls - header
//! lookups, tx fetches); this module owns the provider, the chunked block
//! cursor, sealed-head tracking and backpressure onto the sink.

use std::time::Duration;

use alloy::eips::BlockNumberOrTag;
use alloy::primitives::B256;
use alloy::providers::{DynProvider, Provider, ProviderBuilder};
use alloy::rpc::types::{Filter, Log};
use async_trait::async_trait;
use cross_scout_types::{DomainEvent, EventKind, EventMeta, EventSink, SinkClosed, SourceError};
use tracing::{debug, warn};

/// Static configuration for one polling source.
#[derive(Clone)]
pub struct PollConfig {
    pub name: &'static str,
    pub rpc_url: String,
    pub chain_id: i32,
    /// `None` starts at the head observed on the first successful poll.
    pub start_block: Option<u64>,
    pub poll_ms: u64,
    /// Emit a [`EventKind::BlockSealed`] head event per poll. On for rollup
    /// ELs (feeds reorg reconciliation); off for the L1 settlement poller.
    pub track_heads: bool,
    /// Max blocks per `eth_getLogs` call - public RPCs cap the span.
    pub max_range: u64,
}

/// Async log decoder: turns one raw log into any number of domain events.
#[async_trait]
pub trait LogDecoder: Send + Sync {
    /// The address/topic filter to poll, without the block range.
    fn filter(&self) -> Filter;

    /// Decode one log. Returning an empty vec skips it.
    async fn decode(&self, provider: &DynProvider, log: &Log) -> Vec<DomainEvent>;
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

/// Poll the decoder's filter from `start_block` onward in bounded ranges,
/// decode each log, and forward onto `sink`. Runs until the sink closes.
///
/// # Errors
/// Returns [`SinkClosed`] once the correlation engine drops the receiver.
pub async fn poll_logs<D: LogDecoder>(
    cfg: PollConfig,
    sink: EventSink,
    decoder: D,
) -> Result<(), SourceError> {
    let provider = ProviderBuilder::new()
        .connect_http(cfg.rpc_url.parse()?)
        .erased();
    let base_filter = decoder.filter();
    let mut cursor = cfg.start_block;
    debug!(source = cfg.name, start = ?cursor, "starting log poller");

    loop {
        match provider.get_block_number().await {
            Ok(latest) => {
                if cfg.track_heads {
                    emit_head(&provider, cfg.chain_id, latest, &sink).await?;
                }
                let from = cursor.get_or_insert(latest);
                while *from <= latest {
                    let to = latest.min(*from + cfg.max_range - 1);
                    let filter = base_filter.clone().from_block(*from).to_block(to);
                    match provider.get_logs(&filter).await {
                        Ok(logs) => {
                            for log in &logs {
                                for ev in decoder.decode(&provider, log).await {
                                    sink.send(ev).await.map_err(|_| SinkClosed)?;
                                }
                            }
                            *from = to + 1;
                        }
                        Err(e) => {
                            warn!(source = cfg.name, error = %e, "get_logs failed; retrying");
                            break;
                        }
                    }
                }
            }
            Err(e) => warn!(source = cfg.name, error = %e, "get_block_number failed; retrying"),
        }
        tokio::time::sleep(Duration::from_millis(cfg.poll_ms)).await;
    }
}

/// Emit the current sealed head so the engine can advance `chain_heads` and
/// detect reorgs. Heads between polls are skipped; that only coarsens reorg
/// detection, never correctness (canonical rows key on block hashes).
async fn emit_head(
    provider: &DynProvider,
    chain_id: i32,
    number: u64,
    sink: &EventSink,
) -> Result<(), SourceError> {
    let block = match provider
        .get_block_by_number(BlockNumberOrTag::Number(number))
        .await
    {
        Ok(Some(b)) => b,
        Ok(None) => return Ok(()),
        Err(e) => {
            warn!(chain_id, number, error = %e, "head fetch failed; skipping");
            return Ok(());
        }
    };
    let h = &block.header;
    let ev = DomainEvent::new(
        EventMeta {
            chain_id,
            block_number: number as i64,
            block_hash: h.hash,
            log_index: -1,
            tx_hash: None,
            timestamp: chrono::Utc::now(),
            safe: true,
        },
        EventKind::BlockSealed {
            chain_id,
            number: number as i64,
            hash: h.hash,
            parent_hash: h.parent_hash,
            state_root: h.state_root,
        },
    );
    sink.send(ev).await.map_err(|_| SinkClosed)?;
    Ok(())
}
