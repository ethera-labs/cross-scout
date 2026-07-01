//! The correlation engine: consumes normalized [`DomainEvent`]s, joins them by
//! `instance_id` / `session`, drives each XT through the lifecycle state
//! machine, and publishes DTO deltas for the live stream.

use alloy::primitives::B256;
use cross_scout_store::convert::{hex_prefixed, rfc3339};
use cross_scout_store::repo::MailboxInsert;
use cross_scout_store::{Db, RedisPublisher};
use cross_scout_types::{DomainEvent, EventKind, StreamEvent, Vote, XtStatus, PERIOD_SECONDS};
use tracing::{debug, warn};

use crate::error::CorrelateResult;
use crate::lifecycle::{next_stage, Stage};

fn status_str(s: XtStatus) -> &'static str {
    match s {
        XtStatus::Pending => "pending",
        XtStatus::Unsafe => "unsafe",
        XtStatus::Validated => "validated",
        XtStatus::Finalized => "finalized",
        XtStatus::Failed => "failed",
    }
}

/// Owns the datastore handles and applies events to canonical state.
#[derive(Clone)]
pub struct Correlator {
    db: Db,
    publisher: Option<RedisPublisher>,
    host_chain: i32,
}

impl Correlator {
    pub fn new(db: Db, publisher: Option<RedisPublisher>, host_chain: i32) -> Self {
        Self {
            db,
            publisher,
            host_chain,
        }
    }

    /// Apply one event. Idempotent: a `(chain_id, block_hash, log_index)` that
    /// has already been recorded is a no-op.
    ///
    /// # Errors
    /// Returns [`CorrelateError`](crate::CorrelateError) if a store write fails.
    pub async fn apply(&self, ev: DomainEvent) -> CorrelateResult<()> {
        if !self.db.record_raw_event(&ev).await? {
            debug!(kind = ev.kind_tag(), "duplicate event, skipping");
            return Ok(());
        }
        let meta = &ev.meta;
        let ts = meta.timestamp;

        match &ev.kind {
            EventKind::XtRequested {
                xt_hash,
                instance_id,
                period,
                seq,
                src_chain,
                dst_chain,
                chains,
                sender,
                value_wei,
            } => {
                self.db
                    .ensure_xt(
                        xt_hash,
                        instance_id,
                        Some(*period),
                        Some(*seq),
                        Some(*src_chain),
                        Some(*dst_chain),
                        chains,
                        Some(sender),
                        Some(value_wei),
                        ts,
                    )
                    .await?;
                self.publish_xt(xt_hash, true).await?;
            }

            EventKind::InstanceStarted {
                instance_id,
                period,
                seq,
                chains,
                xt_hash,
            } => {
                self.db
                    .upsert_instance(
                        instance_id,
                        Some(xt_hash),
                        Some(*period),
                        Some(*seq),
                        chains,
                        Some(ts),
                    )
                    .await?;
                self.db
                    .ensure_xt(
                        xt_hash,
                        instance_id,
                        Some(*period),
                        Some(*seq),
                        None,
                        None,
                        chains,
                        None,
                        None,
                        ts,
                    )
                    .await?;
                self.advance_xt(xt_hash, &ev.kind).await?;
            }

            EventKind::SequencerVoted {
                instance_id,
                chain_id,
                commit,
            } => {
                self.db
                    .record_vote(instance_id, *chain_id, *commit, ts)
                    .await?;
                if let Some(xt) = self.db.xt_hash_for_instance(instance_id).await? {
                    self.advance_xt(&xt, &ev.kind).await?;
                }
                self.publish(StreamEvent::Vote {
                    vote: Vote {
                        instance_id: hex_prefixed(instance_id.as_slice()),
                        chain_id: *chain_id,
                        commit: *commit,
                        voted_at: rfc3339(&ts),
                    },
                })
                .await?;
            }

            EventKind::InstanceDecided {
                instance_id,
                commit,
            } => {
                let decision = if *commit { "commit" } else { "abort" };
                self.db
                    .set_instance_decision(instance_id, decision, ts)
                    .await?;
                if let Some(xt) = self.db.xt_hash_for_instance(instance_id).await? {
                    self.advance_xt(&xt, &ev.kind).await?;
                }
            }

            EventKind::MessageDispatched {
                dst_chain_id,
                session,
                header,
                body_hash,
                ..
            } => {
                // The session resolves to the instance, and thus the XT, that
                // this message belongs to.
                let xt = self.db.xt_hash_for_instance(session).await?;
                self.db
                    .insert_mailbox(MailboxInsert {
                        direction: "out",
                        src_chain: Some(self.host_chain),
                        dst_chain: Some(*dst_chain_id),
                        session: Some(session),
                        header: Some(header.as_ref()),
                        body_hash: Some(body_hash),
                        xt_hash: xt.as_ref(),
                        chain_id: meta.chain_id,
                        block_hash: &meta.block_hash,
                        log_index: meta.log_index,
                        ts,
                    })
                    .await?;
                if let Some(x) = xt {
                    self.advance_xt(&x, &ev.kind).await?;
                }
            }

            EventKind::MessageDelivered {
                src_chain_id,
                session,
                ..
            } => {
                let xt = self.db.xt_hash_for_instance(session).await?;
                self.db
                    .insert_mailbox(MailboxInsert {
                        direction: "in",
                        src_chain: Some(*src_chain_id),
                        dst_chain: Some(self.host_chain),
                        session: Some(session),
                        header: None,
                        body_hash: None,
                        xt_hash: xt.as_ref(),
                        chain_id: meta.chain_id,
                        block_hash: &meta.block_hash,
                        log_index: meta.log_index,
                        ts,
                    })
                    .await?;
                if let Some(x) = xt {
                    self.advance_xt(&x, &ev.kind).await?;
                }
            }

            // Root commitments are persisted as raw events for inbox/outbox
            // consistency auditing; they do not advance an individual XT.
            EventKind::OutboxRootUpdated { .. } | EventKind::InboxRootUpdated { .. } => {}

            EventKind::Flashblock { xt_hash, .. } => {
                self.db.set_xt_block(xt_hash, &meta.block_hash).await?;
                self.advance_xt(xt_hash, &ev.kind).await?;
            }

            EventKind::BlockSealed {
                chain_id,
                number,
                hash,
                ..
            } => {
                self.db.update_head(*chain_id, *number, hash, true).await?;
            }

            EventKind::SuperblockProposed {
                number,
                mailbox_root,
                chains,
            } => {
                self.db
                    .upsert_superblock_proposed(*number, mailbox_root, None, ts)
                    .await?;
                let affected = self
                    .db
                    .attach_and_settle_superblock(*number, chains)
                    .await?;
                self.publish_superblock(*number).await?;
                for xt in &affected {
                    self.publish_xt(xt, false).await?;
                }
            }

            EventKind::SuperblockValidated { number, .. } => {
                self.db.set_superblock_validated(*number, None, ts).await?;
                self.db
                    .propagate_superblock_status(*number, Stage::Validated.as_u8(), "validated")
                    .await?;
                self.publish_superblock(*number).await?;
                self.publish_superblock_xts(*number).await?;
            }

            EventKind::SuperblockFinalized {
                number,
                l1_tx,
                l1_block,
            } => {
                self.db
                    .set_superblock_finalized(*number, l1_tx, *l1_block, ts)
                    .await?;
                self.db
                    .propagate_superblock_status(*number, Stage::Finalized.as_u8(), "finalized")
                    .await?;
                self.publish_superblock(*number).await?;
                self.publish_superblock_xts(*number).await?;
            }
        }
        Ok(())
    }

    /// Roll unsafe state on `chain_id` above `ancestor_block` back after a
    /// reorg. Called by ingestion when it detects a head that does not build on
    /// the last hash it saw.
    ///
    /// # Errors
    /// Returns [`CorrelateError`](crate::CorrelateError) if the rollback fails.
    pub async fn handle_reorg(&self, chain_id: i32, ancestor_block: i64) -> CorrelateResult<()> {
        let dropped = self.db.rollback_unsafe(chain_id, ancestor_block).await?;
        if dropped > 0 {
            warn!(
                chain_id,
                ancestor_block, dropped, "reorg: rolled back unsafe events"
            );
        }
        Ok(())
    }

    /// Watchdog pass: log XTs stuck below `Decided` past one period boundary.
    ///
    /// # Errors
    /// Returns [`CorrelateError`](crate::CorrelateError) if the query fails.
    pub async fn sweep_stalled(&self) -> CorrelateResult<()> {
        let stalled = self.db.count_stalled(PERIOD_SECONDS).await?;
        if stalled > 0 {
            warn!(stalled, "XTs stalled past period boundary");
        }
        Ok(())
    }

    async fn advance_xt(&self, xt_hash: &B256, kind: &EventKind) -> CorrelateResult<()> {
        let Some(xt) = self.db.get_xt(xt_hash).await? else {
            return Ok(());
        };
        let current = Stage::from_u8(xt.stage).unwrap_or(Stage::Requested);
        if let Some(next) = next_stage(current, kind) {
            let changed = self
                .db
                .advance_xt_stage(xt_hash, next.as_u8(), status_str(next.status()))
                .await?;
            if changed {
                debug!(stage = ?next, "xt advanced");
                self.publish_xt(xt_hash, false).await?;
            }
        }
        Ok(())
    }

    async fn publish(&self, ev: StreamEvent) -> CorrelateResult<()> {
        if let Some(p) = &self.publisher {
            p.publish(&ev).await?;
        }
        Ok(())
    }

    async fn publish_xt(&self, xt_hash: &B256, is_new: bool) -> CorrelateResult<()> {
        if self.publisher.is_none() {
            return Ok(());
        }
        if let Some(xt) = self.db.get_xt(xt_hash).await? {
            let ev = if is_new {
                StreamEvent::NewXt { xt }
            } else {
                StreamEvent::XtUpdated { xt }
            };
            self.publish(ev).await?;
        }
        Ok(())
    }

    async fn publish_superblock(&self, number: i64) -> CorrelateResult<()> {
        if self.publisher.is_none() {
            return Ok(());
        }
        if let Some(superblock) = self.db.get_superblock(number).await? {
            self.publish(StreamEvent::SuperblockUpdated { superblock })
                .await?;
        }
        Ok(())
    }

    async fn publish_superblock_xts(&self, number: i64) -> CorrelateResult<()> {
        if self.publisher.is_none() {
            return Ok(());
        }
        for xt in self.db.xts_by_superblock(number).await? {
            self.publish(StreamEvent::XtUpdated { xt }).await?;
        }
        Ok(())
    }
}
