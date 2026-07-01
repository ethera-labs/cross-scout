//! Synthetic in-memory source. Emits complete, well-ordered XT lifecycles so
//! the whole pipeline (ingest → correlate → store → api → stream) can run
//! against just Postgres + Redis, with no rollup infrastructure. Enabled by
//! `USE_MOCK_SOURCES=true`.

use std::time::Duration;

use alloy::primitives::{Address, Bytes, B256, U256};
use async_trait::async_trait;
use cross_scout_types::{
    DomainEvent, EventKind, EventMeta, EventSink, SinkClosed, Source, SourceError,
};

fn h256(n: u64) -> B256 {
    B256::from(U256::from(n))
}

/// Emits scripted XT lifecycles in batches, each batch settled by one
/// superblock that then validates and finalizes.
pub struct MockSource {
    host_chain: i32,
}

impl MockSource {
    pub fn new(host_chain: i32) -> Self {
        Self { host_chain }
    }
}

async fn send(
    sink: &EventSink,
    blk: &mut u64,
    chain_id: i32,
    safe: bool,
    kind: EventKind,
) -> Result<(), SourceError> {
    let n = *blk;
    *blk += 1;
    let meta = EventMeta {
        chain_id,
        block_number: n as i64,
        block_hash: h256(n ^ 0x00AB_CDEF),
        log_index: 0,
        tx_hash: Some(h256(n)),
        timestamp: chrono::Utc::now(),
        safe,
    };
    sink.send(DomainEvent::new(meta, kind))
        .await
        .map_err(|_| SinkClosed)?;
    Ok(())
}

#[async_trait]
impl Source for MockSource {
    fn name(&self) -> &'static str {
        "mock"
    }

    async fn run(self: Box<Self>, sink: EventSink) -> Result<(), SourceError> {
        let host = self.host_chain;
        let counterparties = [10i32, 42161, 7_777_777, 480];

        let mut blk: u64 = 1; // increments per event → unique idempotency key
        let mut xt_seq: u64 = 1;
        let mut period: i64 = 1;
        let mut superblock: i64 = 1;

        loop {
            let cp = counterparties[(period as usize) % counterparties.len()];
            let chains = vec![host, cp];

            // ── three XTs, each driven request → included ─────────
            for _ in 0..3 {
                let xt_hash = h256(xt_seq.wrapping_mul(0x9E37_79B9_7F4A_7C15));
                let instance_id = h256(xt_seq.wrapping_mul(0xD1B5_4A32_D192_ED03).wrapping_add(7));
                let session = instance_id; // session ties mailbox messages to this instance/XT
                let sender = Address::from_word(h256(xt_seq.wrapping_add(1_000)));
                let value_wei = U256::from(xt_seq) * U256::from(1_000_000_000_000_000u64);
                xt_seq += 1;

                send(
                    &sink,
                    &mut blk,
                    host,
                    true,
                    EventKind::XtRequested {
                        xt_hash,
                        instance_id,
                        period,
                        seq: 0,
                        src_chain: host,
                        dst_chain: cp,
                        chains: chains.clone(),
                        sender,
                        value_wei,
                    },
                )
                .await?;

                send(
                    &sink,
                    &mut blk,
                    host,
                    true,
                    EventKind::InstanceStarted {
                        instance_id,
                        period,
                        seq: 0,
                        chains: chains.clone(),
                        xt_hash,
                    },
                )
                .await?;

                send(
                    &sink,
                    &mut blk,
                    host,
                    true,
                    EventKind::MessageDispatched {
                        id: h256(xt_seq.wrapping_add(900)),
                        dst_chain_id: cp,
                        session,
                        header: Bytes::from_static(b"mock-xt-header"),
                        body_hash: h256(xt_seq.wrapping_add(55)),
                    },
                )
                .await?;

                send(
                    &sink,
                    &mut blk,
                    cp,
                    true,
                    EventKind::MessageDelivered {
                        id: h256(xt_seq.wrapping_add(901)),
                        src_chain_id: host,
                        session,
                    },
                )
                .await?;

                // both participants vote to commit
                send(
                    &sink,
                    &mut blk,
                    host,
                    true,
                    EventKind::SequencerVoted {
                        instance_id,
                        chain_id: host,
                        commit: true,
                    },
                )
                .await?;
                send(
                    &sink,
                    &mut blk,
                    host,
                    true,
                    EventKind::SequencerVoted {
                        instance_id,
                        chain_id: cp,
                        commit: true,
                    },
                )
                .await?;

                send(
                    &sink,
                    &mut blk,
                    host,
                    true,
                    EventKind::InstanceDecided {
                        instance_id,
                        commit: true,
                    },
                )
                .await?;

                // unsafe pre-confirmation → Included
                send(
                    &sink,
                    &mut blk,
                    host,
                    false,
                    EventKind::Flashblock {
                        chain_id: host,
                        xt_hash,
                        index: 0,
                    },
                )
                .await?;

                tokio::time::sleep(Duration::from_millis(120)).await;
            }

            // ── settle the batch in one superblock ────────────────
            send(
                &sink,
                &mut blk,
                host,
                true,
                EventKind::SuperblockProposed {
                    number: superblock,
                    mailbox_root: h256(superblock.unsigned_abs().wrapping_add(90_000)),
                    chains: chains.clone(),
                },
            )
            .await?;
            tokio::time::sleep(Duration::from_millis(600)).await;

            send(
                &sink,
                &mut blk,
                host,
                true,
                EventKind::SuperblockValidated {
                    number: superblock,
                    proof_id: h256(superblock.unsigned_abs().wrapping_add(70_000)),
                },
            )
            .await?;
            tokio::time::sleep(Duration::from_millis(600)).await;

            let fin_tx = h256(superblock.unsigned_abs().wrapping_add(50_000));
            let fin_block = superblock.wrapping_mul(1000);
            send(
                &sink,
                &mut blk,
                host,
                true,
                EventKind::SuperblockFinalized {
                    number: superblock,
                    l1_tx: fin_tx,
                    l1_block: fin_block,
                },
            )
            .await?;

            superblock += 1;
            period += 1;
            tokio::time::sleep(Duration::from_millis(1_500)).await;
        }
    }
}
