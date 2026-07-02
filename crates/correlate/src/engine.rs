//! The correlation engine: consumes normalized [`DomainEvent`]s, joins them by
//! session, drives each XT through the lifecycle state machine, and publishes
//! DTO deltas for the live stream.
//!
//! The mailbox session id is the on-chain identity of an XT: `xt_hash` and
//! `instance_id` are both the bytes32-widened session, so every signal that
//! carries the session joins to the same row without any off-chain lookup.

use alloy::primitives::B256;
use cross_scout_store::repo::MailboxInsert;
use cross_scout_store::{Db, RedisPublisher};
use cross_scout_types::{DomainEvent, EventKind, StreamEvent, XtStatus};
use tracing::{debug, warn};

use crate::error::CorrelateResult;
use crate::lifecycle::{next_stage, Stage};

fn status_str(s: XtStatus) -> &'static str {
    match s {
        XtStatus::Pending => "pending",
        XtStatus::Committed => "committed",
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
    /// Seconds an XT may sit without a sealed inclusion before the watchdog
    /// rolls it back (a pre-confirmation that never seals = 2PC abort).
    stall_secs: i64,
}

impl Correlator {
    pub fn new(db: Db, publisher: Option<RedisPublisher>, stall_secs: i64) -> Self {
        Self {
            db,
            publisher,
            stall_secs,
        }
    }

    /// Apply one event. Idempotent: a `(chain_id, block_hash, log_index)` that
    /// has already been recorded is a no-op.
    ///
    /// # Errors
    /// Returns [`CorrelateError`](crate::CorrelateError) if a store write fails.
    pub async fn apply(&self, ev: DomainEvent) -> CorrelateResult<()> {
        // Sealed heads arrive once per poll per chain; they only move the head
        // cursor, so they skip the raw-event journal to keep it signal-only.
        if let EventKind::BlockSealed {
            chain_id,
            number,
            hash,
            parent_hash,
            ..
        } = &ev.kind
        {
            return self.apply_head(*chain_id, *number, hash, parent_hash).await;
        }

        if !self.db.record_raw_event(&ev).await? {
            debug!(kind = ev.kind_tag(), "duplicate event, skipping");
            return Ok(());
        }
        let meta = &ev.meta;
        let ts = meta.timestamp;

        match &ev.kind {
            EventKind::XtRequested {
                session,
                src_chain,
                dst_chain,
                sender,
                value_wei,
            } => {
                let inserted = self
                    .db
                    .ensure_xt(
                        session,
                        session,
                        Some(*src_chain),
                        Some(*dst_chain),
                        &[*src_chain, *dst_chain],
                        Some(sender),
                        Some(value_wei),
                        ts,
                    )
                    .await?;
                self.db
                    .upsert_instance(session, Some(session), &[*src_chain, *dst_chain], Some(ts))
                    .await?;
                self.publish_xt(session, inserted).await?;
            }

            EventKind::MessageDispatched {
                session,
                src_chain,
                dst_chain,
                sender,
                receiver,
                label,
                ..
            }
            | EventKind::MessageDelivered {
                session,
                src_chain,
                dst_chain,
                sender,
                receiver,
                label,
                ..
            } => {
                let inserted = self
                    .db
                    .ensure_xt(
                        session,
                        session,
                        Some(*src_chain),
                        Some(*dst_chain),
                        &[*src_chain, *dst_chain],
                        Some(sender),
                        None,
                        ts,
                    )
                    .await?;
                self.db
                    .upsert_instance(session, Some(session), &[*src_chain, *dst_chain], Some(ts))
                    .await?;

                let direction = match &ev.kind {
                    EventKind::MessageDispatched { .. } => "out",
                    _ => "in",
                };
                self.db
                    .insert_mailbox(MailboxInsert {
                        direction,
                        src_chain: Some(*src_chain),
                        dst_chain: Some(*dst_chain),
                        session: Some(session),
                        sender: Some(sender),
                        receiver: Some(receiver),
                        label: Some(label),
                        xt_hash: Some(session),
                        chain_id: meta.chain_id,
                        block_hash: &meta.block_hash,
                        log_index: meta.log_index,
                        ts,
                    })
                    .await?;

                // The sealed mailbox write anchors the XT for reorg handling
                // and commits the session: the builders only execute an XT the
                // publisher decided to commit.
                self.db.set_xt_block(session, &meta.block_hash).await?;
                self.db.set_instance_decision(session, "commit", ts).await?;

                if inserted {
                    self.publish_xt(session, true).await?;
                }
                self.advance_xt(session, &ev.kind).await?;
            }

            // Short-circuited before the raw-event journal above.
            EventKind::BlockSealed { .. } => {}

            EventKind::SuperblockProposed {
                number,
                root_claim,
                hash,
                parent_hash,
                chains,
                transitions,
            } => {
                self.db
                    .upsert_superblock_proposed(
                        *number,
                        root_claim,
                        hash,
                        parent_hash,
                        meta.tx_hash.as_ref(),
                        meta.block_number,
                        ts,
                    )
                    .await?;
                for t in transitions {
                    self.db
                        .upsert_superblock_chain(
                            *number,
                            t.chain_id,
                            Some(t.l2_block),
                            Some(&t.pre_root),
                            Some(&t.post_root),
                            Some(&t.config_hash),
                        )
                        .await?;
                }
                let affected = self
                    .db
                    .attach_and_settle_superblock(*number, chains)
                    .await?;
                self.publish_superblock(*number).await?;
                for xt in &affected {
                    self.publish_xt(xt, false).await?;
                }
            }

            EventKind::SuperblockFinalized { number, .. } => {
                for n in self.db.finalize_superblocks_up_to(*number, ts).await? {
                    self.db
                        .propagate_superblock_status(n, Stage::Finalized.as_u8(), "finalized")
                        .await?;
                    self.publish_superblock(n).await?;
                    self.publish_superblock_xts(n).await?;
                }
            }
        }
        Ok(())
    }

    /// Move a chain's sealed head and reconcile a reorg when the new head does
    /// not extend the last one we saw.
    async fn apply_head(
        &self,
        chain_id: i32,
        number: i64,
        hash: &B256,
        parent_hash: &B256,
    ) -> CorrelateResult<()> {
        if let Some((prev_number, prev_hash)) = self.db.get_head(chain_id).await? {
            let reorged = (number == prev_number + 1 && *parent_hash != prev_hash)
                || (number <= prev_number && *hash != prev_hash);
            if reorged {
                let ancestor = number.saturating_sub(1);
                let dropped = self.db.rollback_unsealed(chain_id, ancestor).await?;
                warn!(
                    chain_id,
                    ancestor, dropped, "reorg: rolled back unsealed events"
                );
            }
        }
        self.db.update_head(chain_id, number, hash, true).await?;
        Ok(())
    }

    /// Watchdog pass: roll back XTs that never reached a sealed inclusion
    /// within the stall window - the observable form of a 2PC abort.
    ///
    /// # Errors
    /// Returns [`CorrelateError`](crate::CorrelateError) if the store write fails.
    pub async fn sweep_stalled(&self) -> CorrelateResult<()> {
        let stalled = self.db.mark_stalled(self.stall_secs).await?;
        if stalled.is_empty() {
            return Ok(());
        }
        warn!(count = stalled.len(), "rolled back stalled XTs");
        let now = chrono::Utc::now();
        for xt in &stalled {
            self.db.set_instance_decision(xt, "abort", now).await?;
            self.publish_xt(xt, false).await?;
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
