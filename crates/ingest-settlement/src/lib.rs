//! L1 settlement ingestion: superblock proposal, aggregated-proof validation
//! (op-succinct / SP1) and on-chain finalization. Polls the settlement contract
//! on L1. Reuses the generic EVM log poller from `ingest-el`.

use alloy::primitives::Address;
use alloy::rpc::types::Log;
use alloy::sol;
use alloy::sol_types::SolEvent;
use async_trait::async_trait;
use cross_scout_ingest_el::evm::{meta_of, poll_logs, topic0, PollConfig};
use cross_scout_types::{DomainEvent, EventKind, EventSink, Source, SourceError};

sol! {
    #[allow(missing_docs)]
    event SuperblockProposed(uint64 number, bytes32 mailboxRoot, uint32[] chains);
    #[allow(missing_docs)]
    event SuperblockValidated(uint64 number, bytes32 proofId);
    #[allow(missing_docs)]
    event SuperblockFinalized(uint64 number, bytes32 l1Tx, uint64 l1Block);
}

/// Decode one L1 settlement log.
pub fn decode_settlement(chain_id: i32, log: &Log) -> Option<DomainEvent> {
    let t0 = topic0(log)?;
    let data = &log.inner.data;

    let kind = if t0 == SuperblockProposed::SIGNATURE_HASH {
        let e = SuperblockProposed::decode_log_data(data).ok()?;
        EventKind::SuperblockProposed {
            number: e.number as i64,
            mailbox_root: e.mailboxRoot,
            chains: e.chains.into_iter().map(|c| c as i32).collect(),
        }
    } else if t0 == SuperblockValidated::SIGNATURE_HASH {
        let e = SuperblockValidated::decode_log_data(data).ok()?;
        EventKind::SuperblockValidated {
            number: e.number as i64,
            proof_id: e.proofId,
        }
    } else if t0 == SuperblockFinalized::SIGNATURE_HASH {
        let e = SuperblockFinalized::decode_log_data(data).ok()?;
        EventKind::SuperblockFinalized {
            number: e.number as i64,
            l1_tx: e.l1Tx,
            l1_block: e.l1Block as i64,
        }
    } else {
        return None;
    };

    Some(DomainEvent::new(meta_of(chain_id, log, true), kind))
}

/// Polls the L1 settlement contract for superblock lifecycle events.
pub struct SettlementSource {
    cfg: PollConfig,
}

impl SettlementSource {
    pub fn new(
        l1_rpc_url: impl Into<String>,
        settlement: Address,
        l1_chain_id: i32,
        start_block: u64,
        poll_ms: u64,
    ) -> Self {
        Self {
            cfg: PollConfig {
                name: "ingest-settlement",
                rpc_url: l1_rpc_url.into(),
                address: settlement,
                chain_id: l1_chain_id,
                start_block,
                poll_ms,
            },
        }
    }
}

#[async_trait]
impl Source for SettlementSource {
    fn name(&self) -> &'static str {
        "ingest-settlement"
    }

    async fn run(self: Box<Self>, sink: EventSink) -> Result<(), SourceError> {
        poll_logs(self.cfg, sink, decode_settlement).await
    }
}
