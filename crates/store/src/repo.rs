//! Canonical write + read operations. All writes are idempotent so replays,
//! overlapping backfills and duplicate deliveries converge to the same state.

use alloy::primitives::{Address, B256, U256};
use bigdecimal::BigDecimal;
use chrono::{DateTime, Utc};
use cross_scout_types::{
    Deposit, DomainEvent, Instance, Superblock, TokenMeta, Transfer, Withdrawal, Xt, XtStatus,
};

use crate::convert::*;
use crate::rows::*;
use crate::write::{
    DepositInsert, MailboxInsert, TransferInsert, WithdrawalFinalizedInsert,
    WithdrawalInitiatedInsert, WithdrawalProvenInsert, XtObservation, XtObservationEffect,
};
use crate::{Db, StoreResult};

impl Db {
    // ── idempotency ───────────────────────────────────────────────

    /// Record a decoded event. Returns `true` if it was new; `false` means we
    /// have already processed this `(chain_id, block_hash, log_index)` and the
    /// caller should skip it.
    pub async fn record_raw_event(&self, ev: &DomainEvent) -> StoreResult<bool> {
        let tx_hash = ev.meta.tx_hash.as_ref().map(b256_bytes);
        let res = sqlx::query(
            r#"insert into raw_events
                 (chain_id, block_number, block_hash, log_index, tx_hash, kind, safe)
               values ($1,$2,$3,$4,$5,$6,$7)
               on conflict (chain_id, block_hash, log_index) do nothing"#,
        )
        .bind(ev.meta.chain_id)
        .bind(ev.meta.block_number)
        .bind(b256_bytes(&ev.meta.block_hash))
        .bind(ev.meta.log_index)
        .bind(tx_hash)
        .bind(ev.kind_tag())
        .bind(ev.meta.safe)
        .execute(&self.pool)
        .await?;
        Ok(res.rows_affected() == 1)
    }

    // ── xts ───────────────────────────────────────────────────────

    /// Record an XT observation. Never regresses `stage`/`status`, and
    /// canonical fields are first-write-wins. `value_wei` must only ever be
    /// passed for a native-ETH leg - token base units never belong in it.
    pub async fn record_xt_observation(
        &self,
        obs: &XtObservation<'_>,
    ) -> StoreResult<XtObservationEffect> {
        let identity = obs.identity;
        let src_chain = identity.map(|i| i.src_chain);
        let dst_chain = identity.map(|i| i.dst_chain);
        let sender = identity.map(|i| address_bytes(i.sender));
        let receiver = identity.map(|i| address_bytes(i.receiver));
        let label = identity.and_then(|i| i.label);
        let value_wei = obs.value_wei.map(u256_decimal);
        let src_tx_hash = obs.src_tx_hash.map(b256_bytes);

        // `xmax = 0` distinguishes a fresh insert from a conflict-update. The
        // conflict path updates only when the observation contributes a
        // first-write-wins field, avoiding no-op rewrites on duplicate facts.
        let inserted: Option<bool> = sqlx::query_scalar(
            r#"insert into xts
                 (xt_hash, src_chain, dst_chain, chains, sender, receiver, label,
                  value_wei, src_tx_hash, status, stage, first_seen_at, updated_at)
               values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',1,$10,$10)
               on conflict (xt_hash) do update set
                 src_chain   = coalesce(xts.src_chain, excluded.src_chain),
                 dst_chain   = coalesce(xts.dst_chain, excluded.dst_chain),
                 chains      = case when array_length(excluded.chains,1) is not null
                                    then excluded.chains else xts.chains end,
                 sender      = coalesce(xts.sender, excluded.sender),
                 receiver    = coalesce(xts.receiver, excluded.receiver),
                 label       = coalesce(xts.label, excluded.label),
                 value_wei   = coalesce(xts.value_wei, excluded.value_wei),
                 src_tx_hash = coalesce(xts.src_tx_hash, excluded.src_tx_hash),
                 updated_at  = now()
               where (xts.src_chain is null and excluded.src_chain is not null)
                  or (xts.dst_chain is null and excluded.dst_chain is not null)
                  or (coalesce(array_length(xts.chains, 1), 0) = 0
                      and array_length(excluded.chains, 1) is not null)
                  or (xts.sender is null and excluded.sender is not null)
                  or (xts.receiver is null and excluded.receiver is not null)
                  or (xts.label is null and excluded.label is not null)
                  or (xts.value_wei is null and excluded.value_wei is not null)
                  or (xts.src_tx_hash is null and excluded.src_tx_hash is not null)
               returning (xmax = 0)"#,
        )
        .bind(b256_bytes(obs.xt_hash))
        .bind(src_chain)
        .bind(dst_chain)
        .bind(obs.participants())
        .bind(sender)
        .bind(receiver)
        .bind(label)
        .bind(value_wei)
        .bind(src_tx_hash)
        .bind(obs.first_seen)
        .fetch_optional(&self.pool)
        .await?;
        Ok(XtObservationEffect::from_insert_return(inserted))
    }

    /// Stamp the first time an XT was seen pre-confirmed (flashblock leg).
    /// First-write-wins; never advances stage/status on its own.
    pub async fn set_preconfirmed_at(&self, xt_hash: &B256, ts: DateTime<Utc>) -> StoreResult<()> {
        sqlx::query(
            r#"update xts
                 set preconfirmed_at = coalesce(preconfirmed_at, $2), updated_at = now()
               where xt_hash = $1"#,
        )
        .bind(b256_bytes(xt_hash))
        .bind(ts)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    fn xt_status_str(s: XtStatus) -> &'static str {
        match s {
            XtStatus::Pending => "pending",
            XtStatus::Committed => "committed",
            XtStatus::Validated => "validated",
            XtStatus::Finalized => "finalized",
            XtStatus::Failed => "failed",
        }
    }

    /// Advance an XT to `stage`/`status`, monotonically - an out-of-order or
    /// duplicate event carrying an earlier stage is ignored. The terminal
    /// rollback stage (255) always applies. Stamps `included_at` first-write
    /// when the advance reaches inclusion (stage 6 or beyond).
    pub async fn advance_xt_stage(
        &self,
        xt_hash: &B256,
        stage: u8,
        status: XtStatus,
        ts: DateTime<Utc>,
    ) -> StoreResult<bool> {
        let res = sqlx::query(
            r#"update xts set
                 stage = $2,
                 status = $3,
                 included_at = case when $2 >= 6 and $2 <> 255
                                    then coalesce(included_at, $4) else included_at end,
                 updated_at = now()
               where xt_hash = $1 and (stage < $2 or $2 = 255)"#,
        )
        .bind(b256_bytes(xt_hash))
        .bind(stage as i16)
        .bind(Self::xt_status_str(status))
        .bind(ts)
        .execute(&self.pool)
        .await?;
        Ok(res.rows_affected() == 1)
    }

    /// Record the inclusion block for an XT (the reorg anchor).
    pub async fn set_xt_block(&self, xt_hash: &B256, block_hash: &B256) -> StoreResult<()> {
        sqlx::query("update xts set block_hash=$2, updated_at=now() where xt_hash=$1")
            .bind(b256_bytes(xt_hash))
            .bind(b256_bytes(block_hash))
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// Roll back every XT still short of a sealed inclusion after `stall_secs`.
    /// A pre-confirmation that never seals is an aborted 2PC instance; this is
    /// the observable abort signal. Returns the affected XT hashes.
    pub async fn mark_stalled(&self, stall_secs: i64) -> StoreResult<Vec<B256>> {
        let rows: Vec<Vec<u8>> = sqlx::query_scalar(
            r#"update xts set
                 stage = 255,
                 status = 'failed',
                 failed_at = coalesce(failed_at, now()),
                 updated_at = now()
               where stage < 6 and status = 'pending'
                 and first_seen_at < now() - make_interval(secs => $1)
               returning xt_hash"#,
        )
        .bind(stall_secs as f64)
        .fetch_all(&self.pool)
        .await?;
        Ok(b256_list(rows))
    }

    // ── instances (sessions) ──────────────────────────────────────

    pub async fn upsert_instance(
        &self,
        session: &B256,
        xt_hash: Option<&B256>,
        participants: &[i32],
        started_at: Option<DateTime<Utc>>,
    ) -> StoreResult<()> {
        sqlx::query(
            r#"insert into instances
                 (session, xt_hash, participants, decision, started_at)
               values ($1,$2,$3,'pending',$4)
               on conflict (session) do update set
                 xt_hash      = coalesce(instances.xt_hash, excluded.xt_hash),
                 participants = case when array_length(excluded.participants,1) is not null
                                     then excluded.participants else instances.participants end,
                 started_at   = coalesce(instances.started_at, excluded.started_at)"#,
        )
        .bind(b256_bytes(session))
        .bind(xt_hash.map(b256_bytes))
        .bind(participants)
        .bind(started_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Set the derived decision once, keeping the first observed outcome.
    pub async fn set_instance_decision(
        &self,
        session: &B256,
        decision: &str,
        decided_at: DateTime<Utc>,
    ) -> StoreResult<()> {
        sqlx::query(
            r#"update instances
                 set decision=$2, decided_at=coalesce(decided_at, $3)
               where session=$1 and decision='pending'"#,
        )
        .bind(b256_bytes(session))
        .bind(decision)
        .bind(decided_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    // ── mailbox ───────────────────────────────────────────────────

    pub async fn insert_mailbox(&self, m: MailboxInsert<'_>) -> StoreResult<()> {
        sqlx::query(
            r#"insert into mailbox_messages
                 (direction, src_chain, dst_chain, session, sender, receiver, label,
                  xt_hash, chain_id, block_number, block_hash, log_index, tx_hash,
                  gas_used, effective_gas_price_wei, ts)
               values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
               on conflict (chain_id, block_hash, log_index) do nothing"#,
        )
        .bind(m.direction)
        .bind(m.src_chain)
        .bind(m.dst_chain)
        .bind(m.session.map(b256_bytes))
        .bind(m.sender.map(address_bytes))
        .bind(m.receiver.map(address_bytes))
        .bind(m.label)
        .bind(m.xt_hash.map(b256_bytes))
        .bind(m.chain_id)
        .bind(m.block_number)
        .bind(b256_bytes(m.block_hash))
        .bind(m.log_index)
        .bind(m.tx_hash.map(b256_bytes))
        .bind(m.gas_used.map(u256_decimal))
        .bind(m.effective_gas_price_wei.map(u256_decimal))
        .bind(m.ts)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    // ── transfers + tokens ────────────────────────────────────────

    /// Persist one source-leg transfer, idempotent on its log coordinates.
    pub async fn insert_transfer(&self, t: TransferInsert<'_>) -> StoreResult<()> {
        sqlx::query(
            r#"insert into transfers
                 (session, kind, token, amount, src_chain, dst_chain, sender, receiver,
                  message_id, chain_id, block_number, block_hash, log_index, tx_hash, safe, ts)
               values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
               on conflict (chain_id, block_hash, log_index) do nothing"#,
        )
        .bind(b256_bytes(t.session))
        .bind(t.kind)
        .bind(t.token.map(address_bytes))
        .bind(u256_decimal(t.amount))
        .bind(t.src_chain)
        .bind(t.dst_chain)
        .bind(address_bytes(t.sender))
        .bind(address_bytes(t.receiver))
        .bind(t.message_id.map(b256_bytes))
        .bind(t.chain_id)
        .bind(t.block_number)
        .bind(b256_bytes(t.block_hash))
        .bind(t.log_index)
        .bind(t.tx_hash.map(b256_bytes))
        .bind(t.safe)
        .bind(t.ts)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Ensure a stub token row exists so the resolver can later fill it in.
    pub async fn ensure_token(&self, chain_id: i32, address: &Address) -> StoreResult<()> {
        sqlx::query(
            r#"insert into tokens (chain_id, address)
               values ($1,$2)
               on conflict (chain_id, address) do nothing"#,
        )
        .bind(chain_id)
        .bind(address_bytes(address))
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Tokens still awaiting metadata resolution, oldest first.
    pub async fn unresolved_tokens(&self, limit: i64) -> StoreResult<Vec<(i32, Address)>> {
        let rows: Vec<(i32, Vec<u8>)> = sqlx::query_as(
            r#"select chain_id, address from tokens
               where refreshed_at is null
               order by first_seen_at asc
               limit $1"#,
        )
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .filter(|(_, a)| a.len() == 20)
            .map(|(c, a)| (c, Address::from_slice(&a)))
            .collect())
    }

    /// Record resolved ERC-20 metadata and stamp `refreshed_at`.
    pub async fn resolve_token(
        &self,
        chain_id: i32,
        address: &Address,
        symbol: Option<&str>,
        name: Option<&str>,
        decimals: Option<i32>,
    ) -> StoreResult<()> {
        sqlx::query(
            r#"update tokens
                 set symbol=$3, name=$4, decimals=$5, refreshed_at=now()
               where chain_id=$1 and address=$2"#,
        )
        .bind(chain_id)
        .bind(address_bytes(address))
        .bind(symbol)
        .bind(name)
        .bind(decimals)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    // ── OP Stack deposits and withdrawals ────────────────────────

    /// Persist one L1-to-L2 deposit initiation from an `OptimismPortal`.
    pub async fn upsert_deposit_initiated(&self, d: DepositInsert<'_>) -> StoreResult<()> {
        sqlx::query(
            r#"insert into deposits
                 (source_hash, l2_chain_id, sender, receiver, mint_wei, value_wei,
                  gas_limit, is_creation, status, l1_chain_id, l1_block_number,
                  l1_block_hash, l1_log_index, l1_tx_hash, initiated_at, updated_at)
               values ($1,$2,$3,$4,$5,$6,$7,$8,'initiated',$9,$10,$11,$12,$13,$14,now())
               on conflict (source_hash) do update set
                 sender      = coalesce(deposits.sender, excluded.sender),
                 receiver    = coalesce(deposits.receiver, excluded.receiver),
                 mint_wei    = coalesce(deposits.mint_wei, excluded.mint_wei),
                 value_wei   = coalesce(deposits.value_wei, excluded.value_wei),
                 gas_limit   = coalesce(deposits.gas_limit, excluded.gas_limit),
                 is_creation = deposits.is_creation or excluded.is_creation,
                 updated_at  = now()"#,
        )
        .bind(b256_bytes(d.source_hash))
        .bind(d.l2_chain_id)
        .bind(address_bytes(d.sender))
        .bind(address_bytes(d.receiver))
        .bind(u256_decimal(d.mint))
        .bind(u256_decimal(d.value))
        .bind(BigDecimal::from(d.gas_limit))
        .bind(d.is_creation)
        .bind(d.l1_chain_id)
        .bind(d.l1_block_number)
        .bind(b256_bytes(d.l1_block_hash))
        .bind(d.l1_log_index)
        .bind(d.l1_tx_hash.map(b256_bytes))
        .bind(d.ts)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Persist one L2-to-L1 withdrawal initiation from `L2ToL1MessagePasser`.
    pub async fn upsert_withdrawal_initiated(
        &self,
        w: WithdrawalInitiatedInsert<'_>,
    ) -> StoreResult<()> {
        sqlx::query(
            r#"insert into withdrawals
                 (withdrawal_hash, l2_chain_id, nonce, sender, target, value_wei, gas_limit,
                  status, initiated_chain_id, initiated_block_number, initiated_block_hash,
                  initiated_log_index, initiated_tx_hash, initiated_at, updated_at)
               values ($1,$2,$3,$4,$5,$6,$7,'initiated',$8,$9,$10,$11,$12,$13,now())
               on conflict (withdrawal_hash) do update set
                 l2_chain_id            = excluded.l2_chain_id,
                 nonce                  = coalesce(withdrawals.nonce, excluded.nonce),
                 sender                 = coalesce(withdrawals.sender, excluded.sender),
                 target                 = coalesce(withdrawals.target, excluded.target),
                 value_wei              = coalesce(withdrawals.value_wei, excluded.value_wei),
                 gas_limit              = coalesce(withdrawals.gas_limit, excluded.gas_limit),
                 initiated_chain_id     = coalesce(withdrawals.initiated_chain_id, excluded.initiated_chain_id),
                 initiated_block_number = coalesce(withdrawals.initiated_block_number, excluded.initiated_block_number),
                 initiated_block_hash   = coalesce(withdrawals.initiated_block_hash, excluded.initiated_block_hash),
                 initiated_log_index    = coalesce(withdrawals.initiated_log_index, excluded.initiated_log_index),
                 initiated_tx_hash      = coalesce(withdrawals.initiated_tx_hash, excluded.initiated_tx_hash),
                 initiated_at           = coalesce(withdrawals.initiated_at, excluded.initiated_at),
                 updated_at             = now()"#,
        )
        .bind(b256_bytes(w.withdrawal_hash))
        .bind(w.l2_chain_id)
        .bind(u256_decimal(w.nonce))
        .bind(address_bytes(w.sender))
        .bind(address_bytes(w.target))
        .bind(u256_decimal(w.value))
        .bind(u256_decimal(w.gas_limit))
        .bind(w.chain_id)
        .bind(w.block_number)
        .bind(b256_bytes(w.block_hash))
        .bind(w.log_index)
        .bind(w.tx_hash.map(b256_bytes))
        .bind(w.ts)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Mark a withdrawal as proven on L1, preserving a later finalization if
    /// events are backfilled out of order.
    pub async fn mark_withdrawal_proven(&self, w: WithdrawalProvenInsert<'_>) -> StoreResult<()> {
        sqlx::query(
            r#"insert into withdrawals
                 (withdrawal_hash, l2_chain_id, status, proven_l1_chain_id,
                  proven_l1_block_number, proven_l1_block_hash, proven_l1_log_index,
                  proven_l1_tx_hash, proven_at, updated_at)
               values ($1,$2,'proven',$3,$4,$5,$6,$7,$8,now())
               on conflict (withdrawal_hash) do update set
                 l2_chain_id            = excluded.l2_chain_id,
                 status                 = case
                                            when withdrawals.status in ('finalized','finalized_failed')
                                            then withdrawals.status
                                            else 'proven'
                                          end,
                 proven_l1_chain_id     = coalesce(withdrawals.proven_l1_chain_id, excluded.proven_l1_chain_id),
                 proven_l1_block_number = coalesce(withdrawals.proven_l1_block_number, excluded.proven_l1_block_number),
                 proven_l1_block_hash   = coalesce(withdrawals.proven_l1_block_hash, excluded.proven_l1_block_hash),
                 proven_l1_log_index    = coalesce(withdrawals.proven_l1_log_index, excluded.proven_l1_log_index),
                 proven_l1_tx_hash      = coalesce(withdrawals.proven_l1_tx_hash, excluded.proven_l1_tx_hash),
                 proven_at              = coalesce(withdrawals.proven_at, excluded.proven_at),
                 updated_at             = now()"#,
        )
        .bind(b256_bytes(w.withdrawal_hash))
        .bind(w.l2_chain_id)
        .bind(w.l1_chain_id)
        .bind(w.l1_block_number)
        .bind(b256_bytes(w.l1_block_hash))
        .bind(w.l1_log_index)
        .bind(w.l1_tx_hash.map(b256_bytes))
        .bind(w.ts)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Mark a withdrawal as finalized on L1. `success=false` records a portal
    /// finalization event where the target call reverted.
    pub async fn mark_withdrawal_finalized(
        &self,
        w: WithdrawalFinalizedInsert<'_>,
    ) -> StoreResult<()> {
        let status = if w.success {
            "finalized"
        } else {
            "finalized_failed"
        };
        sqlx::query(
            r#"insert into withdrawals
                 (withdrawal_hash, l2_chain_id, status, finalized_success,
                  finalized_l1_chain_id, finalized_l1_block_number,
                  finalized_l1_block_hash, finalized_l1_log_index,
                  finalized_l1_tx_hash, finalized_at, updated_at)
               values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
               on conflict (withdrawal_hash) do update set
                 l2_chain_id                = excluded.l2_chain_id,
                 status                     = excluded.status,
                 finalized_success          = excluded.finalized_success,
                 finalized_l1_chain_id      = coalesce(withdrawals.finalized_l1_chain_id, excluded.finalized_l1_chain_id),
                 finalized_l1_block_number  = coalesce(withdrawals.finalized_l1_block_number, excluded.finalized_l1_block_number),
                 finalized_l1_block_hash    = coalesce(withdrawals.finalized_l1_block_hash, excluded.finalized_l1_block_hash),
                 finalized_l1_log_index     = coalesce(withdrawals.finalized_l1_log_index, excluded.finalized_l1_log_index),
                 finalized_l1_tx_hash       = coalesce(withdrawals.finalized_l1_tx_hash, excluded.finalized_l1_tx_hash),
                 finalized_at               = coalesce(withdrawals.finalized_at, excluded.finalized_at),
                 updated_at                 = now()"#,
        )
        .bind(b256_bytes(w.withdrawal_hash))
        .bind(w.l2_chain_id)
        .bind(status)
        .bind(w.success)
        .bind(w.l1_chain_id)
        .bind(w.l1_block_number)
        .bind(b256_bytes(w.l1_block_hash))
        .bind(w.l1_log_index)
        .bind(w.l1_tx_hash.map(b256_bytes))
        .bind(w.ts)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    // ── superblocks ───────────────────────────────────────────────

    #[expect(
        clippy::too_many_arguments,
        reason = "arg list matches the superblocks columns; a params struct would not read better"
    )]
    pub async fn upsert_superblock_proposed(
        &self,
        number: i64,
        root_claim: &B256,
        hash: &B256,
        parent_hash: &B256,
        game_address: &Address,
        l1_tx: Option<&B256>,
        l1_gas_used: Option<&U256>,
        l1_effective_gas_price_wei: Option<&U256>,
        l1_block: i64,
        proposed_at: DateTime<Utc>,
    ) -> StoreResult<bool> {
        let result = sqlx::query(
            r#"insert into superblocks
                 (number, root_claim, hash, parent_hash, game_address, l1_tx, l1_block,
                  l1_gas_used, l1_effective_gas_price_wei, status, proposed_at)
               values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'proposed',$10)
               on conflict (number) do update set
                 root_claim   = excluded.root_claim,
                 hash         = excluded.hash,
                 parent_hash  = excluded.parent_hash,
                 game_address = coalesce(superblocks.game_address, excluded.game_address),
                 l1_tx        = coalesce(superblocks.l1_tx, excluded.l1_tx),
                 l1_block     = coalesce(superblocks.l1_block, excluded.l1_block),
                 l1_gas_used  = coalesce(superblocks.l1_gas_used, excluded.l1_gas_used),
                 l1_effective_gas_price_wei = coalesce(superblocks.l1_effective_gas_price_wei,
                                                       excluded.l1_effective_gas_price_wei),
                 proposed_at  = coalesce(superblocks.proposed_at, excluded.proposed_at)
               where superblocks.hash = excluded.hash"#,
        )
        .bind(number)
        .bind(b256_bytes(root_claim))
        .bind(b256_bytes(hash))
        .bind(b256_bytes(parent_hash))
        .bind(address_bytes(game_address))
        .bind(l1_tx.map(b256_bytes))
        .bind(l1_block)
        .bind(l1_gas_used.map(u256_decimal))
        .bind(l1_effective_gas_price_wei.map(u256_decimal))
        .bind(proposed_at)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn set_superblock_validated(
        &self,
        number: i64,
        prove_ms: Option<i32>,
        validated_at: DateTime<Utc>,
    ) -> StoreResult<()> {
        sqlx::query(
            r#"update superblocks
                 set status = case when status='finalized' then status else 'validated' end,
                     prove_ms = coalesce($2, prove_ms),
                     validated_at = coalesce(validated_at, $3)
               where number=$1"#,
        )
        .bind(number)
        .bind(prove_ms)
        .bind(validated_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Finalize every superblock at or below `number` (the anchor registry
    /// advances monotonically and may skip numbers). Returns the numbers that
    /// actually transitioned so the caller can propagate + publish.
    pub async fn finalize_superblocks_up_to(
        &self,
        number: i64,
        finalized_at: DateTime<Utc>,
    ) -> StoreResult<Vec<i64>> {
        let rows: Vec<i64> = sqlx::query_scalar(
            r#"update superblocks
                 set status='finalized', finalized_at = coalesce(finalized_at, $2)
               where number <= $1 and status <> 'finalized'
               returning number"#,
        )
        .bind(number)
        .bind(finalized_at)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    pub async fn upsert_superblock_chain(
        &self,
        number: i64,
        chain_id: i32,
        l2_block: Option<i64>,
        pre_root: Option<&B256>,
        post_root: Option<&B256>,
        config_hash: Option<&B256>,
    ) -> StoreResult<()> {
        sqlx::query(
            r#"insert into superblock_chains
                 (superblock_number, chain_id, l2_block, pre_root, post_root, config_hash)
               values ($1,$2,$3,$4,$5,$6)
               on conflict (superblock_number, chain_id) do update set
                 l2_block    = coalesce(excluded.l2_block, superblock_chains.l2_block),
                 pre_root    = coalesce(excluded.pre_root, superblock_chains.pre_root),
                 post_root   = coalesce(excluded.post_root, superblock_chains.post_root),
                 config_hash = coalesce(excluded.config_hash, superblock_chains.config_hash)"#,
        )
        .bind(number)
        .bind(chain_id)
        .bind(l2_block)
        .bind(pre_root.map(b256_bytes))
        .bind(post_root.map(b256_bytes))
        .bind(config_hash.map(b256_bytes))
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// On `SuperblockProposed`, link every already-included XT whose chain set
    /// overlaps the superblock's chains and has not yet been settled, moving it
    /// to `Settled` (stage 7) and stamping `settled_at`. Returns the affected
    /// XT hashes so the caller can publish stream deltas.
    pub async fn attach_and_settle_superblock(
        &self,
        number: i64,
        chains: &[i32],
        settled_at: DateTime<Utc>,
    ) -> StoreResult<Vec<B256>> {
        let rows: Vec<Vec<u8>> = sqlx::query_scalar(
            r#"update xts set
                 superblock_number = $1,
                 stage = 7,
                 status = 'committed',
                 settled_at = coalesce(settled_at, $3),
                 updated_at = now()
               where superblock_number is null and stage >= 6 and chains && $2::int[]
               returning xt_hash"#,
        )
        .bind(number)
        .bind(chains)
        .bind(settled_at)
        .fetch_all(&self.pool)
        .await?;
        // keep xt_count on the superblock in sync
        sqlx::query(
            "update superblocks set xt_count = (select count(*) from xts where superblock_number=$1) where number=$1",
        )
        .bind(number)
        .execute(&self.pool)
        .await?;
        Ok(b256_list(rows))
    }

    /// Hashes of every XT settled in a given superblock, for stream fan-out.
    pub async fn xt_hashes_by_superblock(&self, number: i64) -> StoreResult<Vec<B256>> {
        let rows: Vec<Vec<u8>> =
            sqlx::query_scalar("select xt_hash from xts where superblock_number=$1")
                .bind(number)
                .fetch_all(&self.pool)
                .await?;
        Ok(b256_list(rows))
    }

    /// Mark every XT settled in a superblock with the superblock's status
    /// transition, so `committed → validated → finalized` propagates to XTs.
    /// Stamps `finalized_at` first-write when propagating finalization.
    pub async fn propagate_superblock_status(
        &self,
        number: i64,
        stage: u8,
        status: &str,
        ts: DateTime<Utc>,
    ) -> StoreResult<()> {
        sqlx::query(
            r#"update xts set
                 stage = $2,
                 status = $3,
                 finalized_at = case when $2 = 9 then coalesce(finalized_at, $4) else finalized_at end,
                 updated_at = now()
               where superblock_number=$1 and (stage < $2 or $2 = 255)"#,
        )
        .bind(number)
        .bind(stage as i16)
        .bind(status)
        .bind(ts)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    // ── periods + publisher snapshots (stats poller) ──────────────

    /// Upsert an observed SBCP period, refreshing `last_seen_at` and filling
    /// the mapped superblock number first-write.
    pub async fn upsert_period(
        &self,
        period_id: i64,
        superblock_number: Option<i64>,
        seen_at: DateTime<Utc>,
    ) -> StoreResult<bool> {
        let result = sqlx::query(
            r#"insert into periods (period_id, superblock_number, first_seen_at, last_seen_at)
               values ($1,$2,$3,$3)
               on conflict (period_id) do update set
                 superblock_number = coalesce(periods.superblock_number, excluded.superblock_number),
                 last_seen_at      = excluded.last_seen_at
               where periods.superblock_number is null
                  or periods.superblock_number = excluded.superblock_number"#,
        )
        .bind(period_id)
        .bind(superblock_number)
        .bind(seen_at)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    /// Append one publisher liveness snapshot. `ts` is the primary key, so a
    /// repeated timestamp is dropped rather than erroring.
    #[expect(
        clippy::too_many_arguments,
        reason = "arg list matches the publisher_snapshots columns; a params struct would not read better"
    )]
    pub async fn insert_publisher_snapshot(
        &self,
        ts: DateTime<Utc>,
        period_id: i64,
        next_superblock: i64,
        last_finalized: i64,
        queued: i32,
        active_xts: i32,
        active_chains: i32,
        connections: i32,
        registered_chains: i32,
        pending_proofs: i32,
    ) -> StoreResult<()> {
        sqlx::query(
            r#"insert into publisher_snapshots
                 (ts, period_id, next_superblock, last_finalized, queued, active_xts,
                  active_chains, connections, registered_chains, pending_proofs)
               values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
               on conflict (ts) do nothing"#,
        )
        .bind(ts)
        .bind(period_id)
        .bind(next_superblock)
        .bind(last_finalized)
        .bind(queued)
        .bind(active_xts)
        .bind(active_chains)
        .bind(connections)
        .bind(registered_chains)
        .bind(pending_proofs)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Drop publisher snapshots older than `keep_secs`, bounding the series.
    pub async fn prune_snapshots(&self, keep_secs: i64) -> StoreResult<u64> {
        let res = sqlx::query(
            "delete from publisher_snapshots where ts < now() - make_interval(secs => $1)",
        )
        .bind(keep_secs as f64)
        .execute(&self.pool)
        .await?;
        Ok(res.rows_affected())
    }

    // ── heads + reorg ─────────────────────────────────────────────

    /// Last sealed head recorded for a chain.
    pub async fn get_head(&self, chain_id: i32) -> StoreResult<Option<(i64, B256)>> {
        let row: Option<(i64, Vec<u8>)> =
            sqlx::query_as("select head_number, head_hash from chain_heads where chain_id=$1")
                .bind(chain_id)
                .fetch_optional(&self.pool)
                .await?;
        Ok(row
            .filter(|(_, h)| h.len() == 32)
            .map(|(n, h)| (n, B256::from_slice(&h))))
    }

    pub async fn update_head(
        &self,
        chain_id: i32,
        number: i64,
        hash: &B256,
        safe: bool,
    ) -> StoreResult<()> {
        sqlx::query(
            r#"insert into chain_heads (chain_id, head_number, head_hash, safe_number, updated_at)
               values ($1,$2,$3, case when $4 then $2 else 0 end, now())
               on conflict (chain_id) do update set
                 head_number = excluded.head_number,
                 head_hash   = excluded.head_hash,
                 safe_number = greatest(chain_heads.safe_number,
                                        case when $4 then excluded.head_number else 0 end),
                 updated_at  = now()"#,
        )
        .bind(chain_id)
        .bind(number)
        .bind(b256_bytes(hash))
        .bind(safe)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Drop every log-keyed row above the last common ancestor after a reorg:
    /// the blocks holding them are no longer canonical, whether the rows came
    /// from pre-confirmations or sealed logs. The poller re-scans the range on
    /// the new branch and canonical rows re-insert under their new block
    /// hashes, keeping money aggregates single-counted. XT stage columns are
    /// monotonic and are re-driven by the re-observed events; XTs seen only in
    /// dropped rows are rolled back by the stall watchdog if they never
    /// re-seal. Returns the number of `raw_events` rows removed.
    pub async fn rollback_above(&self, chain_id: i32, from_block: i64) -> StoreResult<u64> {
        let mut tx = self.pool.begin().await?;
        let dropped = sqlx::query("delete from raw_events where chain_id=$1 and block_number > $2")
            .bind(chain_id)
            .bind(from_block)
            .execute(&mut *tx)
            .await?
            .rows_affected();
        sqlx::query("delete from transfers where chain_id=$1 and block_number > $2")
            .bind(chain_id)
            .bind(from_block)
            .execute(&mut *tx)
            .await?;
        sqlx::query("delete from mailbox_messages where chain_id=$1 and block_number > $2")
            .bind(chain_id)
            .bind(from_block)
            .execute(&mut *tx)
            .await?;
        sqlx::query("delete from deposits where l1_chain_id=$1 and l1_block_number > $2")
            .bind(chain_id)
            .bind(from_block)
            .execute(&mut *tx)
            .await?;
        sqlx::query(
            r#"update withdrawals set
                 nonce = null,
                 sender = null,
                 target = null,
                 value_wei = null,
                 gas_limit = null,
                 initiated_chain_id = null,
                 initiated_block_number = null,
                 initiated_block_hash = null,
                 initiated_log_index = null,
                 initiated_tx_hash = null,
                 initiated_at = null,
                 status = case
                            when finalized_at is not null and finalized_success then 'finalized'
                            when finalized_at is not null then 'finalized_failed'
                            when proven_at is not null then 'proven'
                            else 'initiated'
                          end,
                 updated_at = now()
               where initiated_chain_id=$1 and initiated_block_number > $2"#,
        )
        .bind(chain_id)
        .bind(from_block)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            r#"update withdrawals set
                 proven_l1_chain_id = null,
                 proven_l1_block_number = null,
                 proven_l1_block_hash = null,
                 proven_l1_log_index = null,
                 proven_l1_tx_hash = null,
                 proven_at = null,
                 status = case
                            when finalized_at is not null and finalized_success then 'finalized'
                            when finalized_at is not null then 'finalized_failed'
                            when initiated_at is not null then 'initiated'
                            else 'initiated'
                          end,
                 updated_at = now()
               where proven_l1_chain_id=$1 and proven_l1_block_number > $2"#,
        )
        .bind(chain_id)
        .bind(from_block)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            r#"update withdrawals set
                 finalized_success = null,
                 finalized_l1_chain_id = null,
                 finalized_l1_block_number = null,
                 finalized_l1_block_hash = null,
                 finalized_l1_log_index = null,
                 finalized_l1_tx_hash = null,
                 finalized_at = null,
                 status = case
                            when proven_at is not null then 'proven'
                            when initiated_at is not null then 'initiated'
                            else 'initiated'
                          end,
                 updated_at = now()
               where finalized_l1_chain_id=$1 and finalized_l1_block_number > $2"#,
        )
        .bind(chain_id)
        .bind(from_block)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            r#"delete from withdrawals
               where initiated_at is null and proven_at is null and finalized_at is null"#,
        )
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(dropped)
    }

    // ── reads (DTO projections for the stream + tests) ────────────

    pub async fn get_xt(&self, xt_hash: &B256) -> StoreResult<Option<Xt>> {
        let row = sqlx::query_as::<_, XtRow>("select * from xts where xt_hash=$1")
            .bind(b256_bytes(xt_hash))
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.map(XtRow::into_dto))
    }

    pub async fn get_instance(&self, session: &B256) -> StoreResult<Option<Instance>> {
        let row = sqlx::query_as::<_, InstanceRow>("select * from instances where session=$1")
            .bind(b256_bytes(session))
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.map(InstanceRow::into_dto))
    }

    /// Transfers for one session, newest first.
    pub async fn transfers_by_session(&self, session: &B256) -> StoreResult<Vec<Transfer>> {
        let rows = sqlx::query_as::<_, TransferRow>(
            "select * from transfers where session=$1 order by ts desc",
        )
        .bind(b256_bytes(session))
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(TransferRow::into_dto).collect())
    }

    /// Resolved metadata for one token, if the stub row exists.
    pub async fn get_token(
        &self,
        chain_id: i32,
        address: &Address,
    ) -> StoreResult<Option<TokenMeta>> {
        let row = sqlx::query_as::<_, TokenRow>(
            "select chain_id, address, symbol, name, decimals from tokens where chain_id=$1 and address=$2",
        )
        .bind(chain_id)
        .bind(address_bytes(address))
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(TokenRow::into_dto))
    }

    pub async fn get_superblock(&self, number: i64) -> StoreResult<Option<Superblock>> {
        let row = sqlx::query_as::<_, SuperblockRow>("select * from superblocks where number=$1")
            .bind(number)
            .fetch_optional(&self.pool)
            .await?;
        match row {
            Some(r) => {
                let chains = sqlx::query_as::<_, SuperblockChainRow>(
                    "select * from superblock_chains where superblock_number=$1 order by chain_id",
                )
                .bind(number)
                .fetch_all(&self.pool)
                .await?
                .into_iter()
                .map(SuperblockChainRow::into_dto)
                .collect();
                Ok(Some(r.into_dto(chains)))
            }
            None => Ok(None),
        }
    }

    pub async fn get_deposit(&self, source_hash: &B256) -> StoreResult<Option<Deposit>> {
        let row = sqlx::query_as::<_, DepositRow>("select * from deposits where source_hash=$1")
            .bind(b256_bytes(source_hash))
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.map(DepositRow::into_dto))
    }

    pub async fn get_withdrawal(&self, withdrawal_hash: &B256) -> StoreResult<Option<Withdrawal>> {
        let row = sqlx::query_as::<_, WithdrawalRow>(
            "select * from withdrawals where withdrawal_hash=$1",
        )
        .bind(b256_bytes(withdrawal_hash))
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(WithdrawalRow::into_dto))
    }
}

/// `bytea` rows to `B256`s, dropping any malformed lengths.
fn b256_list(rows: Vec<Vec<u8>>) -> Vec<B256> {
    rows.into_iter()
        .filter(|b| b.len() == 32)
        .map(|b| B256::from_slice(&b))
        .collect()
}
