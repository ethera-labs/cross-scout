//! Execution-layer ingestion: decodes the host rollup's Mailbox contract logs
//! (op-reth EL) into normalized mailbox [`DomainEvent`]s.

pub mod evm;

use alloy::primitives::{keccak256, Address};
use alloy::rpc::types::Log;
use alloy::sol;
use alloy::sol_types::SolEvent;
use async_trait::async_trait;
use cross_scout_types::{DomainEvent, EventKind, EventSink, Source, SourceError};
use evm::{meta_of, poll_logs, topic0, PollConfig};

// Host rollup Mailbox events. Fields are non-indexed, so they decode straight
// from log data.
sol! {
    #[allow(missing_docs)]
    event MessageDispatched(bytes32 id, uint32 dstChainId, bytes32 session, bytes header, bytes body);
    #[allow(missing_docs)]
    event MessageDelivered(bytes32 id, uint32 srcChainId, bytes32 session);
    #[allow(missing_docs)]
    event OutboxRootUpdated(bytes32 root, uint64 index);
    #[allow(missing_docs)]
    event InboxRootUpdated(bytes32 root, uint64 index);
}

/// Decode one Mailbox log into a [`DomainEvent`], or `None` if it isn't one of
/// ours.
pub fn decode_mailbox(chain_id: i32, log: &Log) -> Option<DomainEvent> {
    let t0 = topic0(log)?;
    let data = &log.inner.data;

    let kind = if t0 == MessageDispatched::SIGNATURE_HASH {
        let e = MessageDispatched::decode_log_data(data).ok()?;
        EventKind::MessageDispatched {
            id: e.id,
            dst_chain_id: e.dstChainId as i32,
            session: e.session,
            header: e.header,
            body_hash: keccak256(&e.body),
        }
    } else if t0 == MessageDelivered::SIGNATURE_HASH {
        let e = MessageDelivered::decode_log_data(data).ok()?;
        EventKind::MessageDelivered {
            id: e.id,
            src_chain_id: e.srcChainId as i32,
            session: e.session,
        }
    } else if t0 == OutboxRootUpdated::SIGNATURE_HASH {
        let e = OutboxRootUpdated::decode_log_data(data).ok()?;
        EventKind::OutboxRootUpdated {
            root: e.root,
            index: e.index as i64,
        }
    } else if t0 == InboxRootUpdated::SIGNATURE_HASH {
        let e = InboxRootUpdated::decode_log_data(data).ok()?;
        EventKind::InboxRootUpdated {
            root: e.root,
            index: e.index as i64,
        }
    } else {
        return None;
    };

    Some(DomainEvent::new(meta_of(chain_id, log, true), kind))
}

/// Polls the host rollup's Mailbox contract for cross-chain message logs.
pub struct ElSource {
    cfg: PollConfig,
}

impl ElSource {
    pub fn new(
        rpc_url: impl Into<String>,
        mailbox: Address,
        chain_id: i32,
        start_block: u64,
        poll_ms: u64,
    ) -> Self {
        Self {
            cfg: PollConfig {
                name: "ingest-el",
                rpc_url: rpc_url.into(),
                address: mailbox,
                chain_id,
                start_block,
                poll_ms,
            },
        }
    }
}

#[async_trait]
impl Source for ElSource {
    fn name(&self) -> &'static str {
        "ingest-el"
    }

    async fn run(self: Box<Self>, sink: EventSink) -> Result<(), SourceError> {
        poll_logs(self.cfg, sink, decode_mailbox).await
    }
}
