//! Shared Publisher (SBCP) ingestion: the 2-phase-commit coordinator events -
//! instance scheduling, per-sequencer votes and the final commit/abort
//! decision. Reuses the generic EVM log poller from `ingest-el`.

use alloy::primitives::Address;
use alloy::rpc::types::Log;
use alloy::sol;
use alloy::sol_types::SolEvent;
use async_trait::async_trait;
use cross_scout_ingest_el::evm::{meta_of, poll_logs, topic0, PollConfig};
use cross_scout_types::{DomainEvent, EventKind, EventSink, Source, SourceError};

sol! {
    #[allow(missing_docs)]
    event InstanceStarted(bytes32 instanceId, uint64 period, uint32 seq, uint32[] chains, bytes32 xtHash);
    #[allow(missing_docs)]
    event SequencerVoted(bytes32 instanceId, uint32 chainId, bool commit);
    #[allow(missing_docs)]
    event InstanceDecided(bytes32 instanceId, bool commit);
}

/// Decode one SBCP coordinator log.
pub fn decode_sbcp(chain_id: i32, log: &Log) -> Option<DomainEvent> {
    let t0 = topic0(log)?;
    let data = &log.inner.data;

    let kind = if t0 == InstanceStarted::SIGNATURE_HASH {
        let e = InstanceStarted::decode_log_data(data).ok()?;
        EventKind::InstanceStarted {
            instance_id: e.instanceId,
            period: e.period as i64,
            seq: e.seq as i32,
            chains: e.chains.into_iter().map(|c| c as i32).collect(),
            xt_hash: e.xtHash,
        }
    } else if t0 == SequencerVoted::SIGNATURE_HASH {
        let e = SequencerVoted::decode_log_data(data).ok()?;
        EventKind::SequencerVoted {
            instance_id: e.instanceId,
            chain_id: e.chainId as i32,
            commit: e.commit,
        }
    } else if t0 == InstanceDecided::SIGNATURE_HASH {
        let e = InstanceDecided::decode_log_data(data).ok()?;
        EventKind::InstanceDecided {
            instance_id: e.instanceId,
            commit: e.commit,
        }
    } else {
        return None;
    };

    Some(DomainEvent::new(meta_of(chain_id, log, true), kind))
}

/// Polls the Shared Publisher coordinator contract for 2PC events.
pub struct SbcpSource {
    cfg: PollConfig,
}

impl SbcpSource {
    pub fn new(
        rpc_url: impl Into<String>,
        coordinator: Address,
        chain_id: i32,
        start_block: u64,
        poll_ms: u64,
    ) -> Self {
        Self {
            cfg: PollConfig {
                name: "ingest-sbcp",
                rpc_url: rpc_url.into(),
                address: coordinator,
                chain_id,
                start_block,
                poll_ms,
            },
        }
    }
}

#[async_trait]
impl Source for SbcpSource {
    fn name(&self) -> &'static str {
        "ingest-sbcp"
    }

    async fn run(self: Box<Self>, sink: EventSink) -> Result<(), SourceError> {
        poll_logs(self.cfg, sink, decode_sbcp).await
    }
}
