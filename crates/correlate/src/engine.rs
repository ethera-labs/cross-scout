//! The correlation engine: consumes normalized [`DomainEvent`]s, joins them by
//! session, drives each XT through the lifecycle state machine, and announces
//! row keys on the live-stream channel.
//!
//! The mailbox session id is the on-chain identity of an XT: `xt_hash` is the
//! bytes32-widened session, and the `instances` row keys on that same session,
//! so every signal that carries the session joins to the same rows without any
//! off-chain lookup.

use alloy::primitives::B256;
use chrono::{DateTime, Utc};
use cross_scout_store::write::{
    MailboxInsert, TransferInsert, XtIdentity, XtObservation, XtObservationEffect,
};
use cross_scout_store::{Db, StreamKey, StreamNotifier};
use cross_scout_types::{DomainEvent, EventKind};
use tracing::{debug, warn};

use crate::error::CorrelateResult;
use crate::lifecycle::{next_stage, Stage};
use crate::mailbox::xt_identity_from_mailbox;

/// Owns the datastore handles and applies events to canonical state.
#[derive(Clone)]
pub struct Correlator {
    db: Db,
    publisher: Option<StreamNotifier>,
    /// Seconds an XT may sit without a sealed inclusion before the watchdog
    /// rolls it back (a pre-confirmation that never seals = 2PC abort).
    stall_secs: i64,
}

impl Correlator {
    pub fn new(db: Db, publisher: Option<StreamNotifier>, stall_secs: i64) -> Self {
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
                receiver,
                asset,
                amount,
                message_id,
            } => {
                if meta.safe {
                    // Sealed source-leg bridge log: this is the authoritative
                    // record of the transfer. `value_wei` carries native ETH
                    // only - token amounts stay in `transfers`.
                    let label = if asset.is_none() {
                        "eth-transfer"
                    } else {
                        "erc20-transfer"
                    };
                    let value_wei = asset.is_none().then_some(amount);
                    let obs = XtObservation::new(
                        session,
                        *src_chain,
                        *dst_chain,
                        Some(XtIdentity::new(
                            *src_chain,
                            *dst_chain,
                            sender,
                            receiver,
                            Some(label),
                        )),
                        value_wei,
                        meta.tx_hash.as_ref(),
                        ts,
                    );
                    let write = self.db.record_xt_observation(&obs).await?;
                    self.db
                        .upsert_instance(session, Some(session), obs.participants(), Some(ts))
                        .await?;

                    let kind = if asset.is_none() { "eth" } else { "erc20" };
                    self.db
                        .insert_transfer(TransferInsert {
                            session,
                            kind,
                            token: asset.as_ref(),
                            amount,
                            src_chain: *src_chain,
                            dst_chain: *dst_chain,
                            sender,
                            receiver,
                            message_id: message_id.as_ref(),
                            chain_id: meta.chain_id,
                            block_number: Some(meta.block_number),
                            block_hash: &meta.block_hash,
                            log_index: meta.log_index,
                            tx_hash: meta.tx_hash.as_ref(),
                            safe: true,
                            ts,
                        })
                        .await?;
                    if let Some(asset) = asset {
                        // The bridge emits the source-chain token address, so
                        // the resolver must query the emitting chain.
                        self.db.ensure_token(meta.chain_id, asset).await?;
                    }

                    self.publish_xt_observation(session, write, false).await?;
                } else {
                    // Flashblock pre-confirmation: record only the XT shell and
                    // stamp the pre-conf time. No transfer row - the sealed log
                    // (different block coords) is the one that counts, so
                    // inserting here would double-count once it lands.
                    let obs = XtObservation::new(
                        session,
                        *src_chain,
                        *dst_chain,
                        Some(XtIdentity::new(
                            *src_chain, *dst_chain, sender, receiver, None,
                        )),
                        None,
                        meta.tx_hash.as_ref(),
                        ts,
                    );
                    let write = self.db.record_xt_observation(&obs).await?;
                    self.db
                        .upsert_instance(session, Some(session), obs.participants(), Some(ts))
                        .await?;
                    self.db.set_preconfirmed_at(session, ts).await?;
                    self.publish_xt_observation(session, write, false).await?;
                }
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
                let obs = XtObservation::new(
                    session,
                    *src_chain,
                    *dst_chain,
                    xt_identity_from_mailbox(label, *src_chain, *dst_chain, sender, receiver),
                    None,
                    None,
                    ts,
                );
                let write = self.db.record_xt_observation(&obs).await?;
                self.db
                    .upsert_instance(session, Some(session), obs.participants(), Some(ts))
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
                        block_number: Some(meta.block_number),
                        block_hash: &meta.block_hash,
                        log_index: meta.log_index,
                        tx_hash: meta.tx_hash.as_ref(),
                        gas_used: meta.gas_used.as_ref(),
                        effective_gas_price_wei: meta.effective_gas_price_wei.as_ref(),
                        ts,
                    })
                    .await?;

                // The sealed mailbox write anchors the XT for reorg handling
                // and commits the session: the builders only execute an XT the
                // publisher decided to commit.
                self.db.set_xt_block(session, &meta.block_hash).await?;
                self.db.set_instance_decision(session, "commit", ts).await?;

                let advanced = self.advance_xt_stage(session, &ev.kind, ts).await?;
                self.publish_xt_observation(session, write, advanced)
                    .await?;
            }

            // Short-circuited before the raw-event journal above.
            EventKind::BlockSealed { .. } => {}

            EventKind::SuperblockProposed {
                number,
                root_claim,
                hash,
                parent_hash,
                game_address,
                chains,
                transitions,
            } => {
                self.db
                    .upsert_superblock_proposed(
                        *number,
                        root_claim,
                        hash,
                        parent_hash,
                        game_address,
                        meta.tx_hash.as_ref(),
                        meta.gas_used.as_ref(),
                        meta.effective_gas_price_wei.as_ref(),
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
                    .attach_and_settle_superblock(*number, chains, ts)
                    .await?;
                self.publish_superblock(*number).await?;
                for xt in &affected {
                    self.publish_xt(xt, false).await?;
                }
            }

            EventKind::SuperblockFinalized { number, .. } => {
                for n in self.db.finalize_superblocks_up_to(*number, ts).await? {
                    self.db
                        .propagate_superblock_status(n, Stage::Finalized.as_u8(), "finalized", ts)
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
                let dropped = self.db.rollback_above(chain_id, ancestor).await?;
                warn!(
                    chain_id,
                    ancestor, dropped, "reorg: rolled back events above ancestor"
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

    async fn advance_xt_stage(
        &self,
        xt_hash: &B256,
        kind: &EventKind,
        ts: DateTime<Utc>,
    ) -> CorrelateResult<bool> {
        let Some(xt) = self.db.get_xt(xt_hash).await? else {
            return Ok(false);
        };
        let current = Stage::from_u8(xt.stage).unwrap_or(Stage::Requested);
        if let Some(next) = next_stage(current, kind) {
            let changed = self
                .db
                .advance_xt_stage(xt_hash, next.as_u8(), next.status(), ts)
                .await?;
            if changed {
                debug!(stage = ?next, "xt advanced");
            }
            return Ok(changed);
        }
        Ok(false)
    }

    async fn publish_xt_observation(
        &self,
        xt_hash: &B256,
        effect: XtObservationEffect,
        stage_advanced: bool,
    ) -> CorrelateResult<()> {
        match effect {
            XtObservationEffect::Inserted => self.publish_xt(xt_hash, true).await?,
            XtObservationEffect::Extended => self.publish_xt(xt_hash, false).await?,
            XtObservationEffect::Unchanged if stage_advanced => {
                self.publish_xt(xt_hash, false).await?;
            }
            XtObservationEffect::Unchanged => {}
        }
        Ok(())
    }

    async fn publish(&self, key: StreamKey<'_>) -> CorrelateResult<()> {
        if let Some(p) = &self.publisher {
            p.publish(key).await?;
        }
        Ok(())
    }

    async fn publish_xt(&self, xt_hash: &B256, is_new: bool) -> CorrelateResult<()> {
        let key = if is_new {
            StreamKey::NewXt(xt_hash)
        } else {
            StreamKey::XtUpdated(xt_hash)
        };
        self.publish(key).await
    }

    async fn publish_superblock(&self, number: i64) -> CorrelateResult<()> {
        self.publish(StreamKey::SuperblockUpdated(number)).await
    }

    async fn publish_superblock_xts(&self, number: i64) -> CorrelateResult<()> {
        if self.publisher.is_none() {
            return Ok(());
        }
        for xt_hash in self.db.xt_hashes_by_superblock(number).await? {
            self.publish(StreamKey::XtUpdated(&xt_hash)).await?;
        }
        Ok(())
    }
}
