//! Canonical write + read operations. All writes are idempotent so replays,
//! overlapping backfills and duplicate deliveries converge to the same state.

use alloy::primitives::{Address, B256, U256};
use chrono::{DateTime, Utc};
use cross_scout_types::{DomainEvent, Instance, Superblock, Xt};

use crate::convert::*;
use crate::rows::*;
use crate::{Db, StoreResult};

/// Everything needed to persist one mailbox message.
pub struct MailboxInsert<'a> {
    pub direction: &'a str,
    pub src_chain: Option<i32>,
    pub dst_chain: Option<i32>,
    pub session: Option<&'a B256>,
    pub sender: Option<&'a Address>,
    pub receiver: Option<&'a Address>,
    pub label: Option<&'a str>,
    pub xt_hash: Option<&'a B256>,
    pub chain_id: i32,
    pub block_hash: &'a B256,
    pub log_index: i32,
    pub ts: DateTime<Utc>,
}

impl Db {
    // ── idempotency ───────────────────────────────────────────────

    /// Record a decoded event. Returns `true` if it was new; `false` means we
    /// have already processed this `(chain_id, block_hash, log_index)` and the
    /// caller should skip it.
    pub async fn record_raw_event(&self, ev: &DomainEvent) -> StoreResult<bool> {
        let payload = serde_json::to_value(ev)?;
        let tx_hash = ev.meta.tx_hash.as_ref().map(b256_bytes);
        let res = sqlx::query(
            r#"insert into raw_events
                 (chain_id, block_number, block_hash, log_index, tx_hash, kind, payload, safe)
               values ($1,$2,$3,$4,$5,$6,$7,$8)
               on conflict (chain_id, block_hash, log_index) do nothing"#,
        )
        .bind(ev.meta.chain_id)
        .bind(ev.meta.block_number)
        .bind(b256_bytes(&ev.meta.block_hash))
        .bind(ev.meta.log_index)
        .bind(tx_hash)
        .bind(ev.kind_tag())
        .bind(payload)
        .bind(ev.meta.safe)
        .execute(&self.pool)
        .await?;
        Ok(res.rows_affected() == 1)
    }

    // ── xts ───────────────────────────────────────────────────────

    /// Create the XT row if absent, else fill in any descriptive fields we
    /// learn later. Never regresses `stage`/`status`. Returns `true` when the
    /// row was newly inserted.
    #[expect(
        clippy::too_many_arguments,
        reason = "arg list matches the xts columns; a params struct would not read better"
    )]
    pub async fn ensure_xt(
        &self,
        xt_hash: &B256,
        instance_id: &B256,
        src_chain: Option<i32>,
        dst_chain: Option<i32>,
        chains: &[i32],
        sender: Option<&Address>,
        value_wei: Option<&U256>,
        first_seen: DateTime<Utc>,
    ) -> StoreResult<bool> {
        // `xmax = 0` distinguishes a fresh insert from a conflict-update.
        let inserted: bool = sqlx::query_scalar(
            r#"insert into xts
                 (xt_hash, instance_id, src_chain, dst_chain, chains,
                  sender, value_wei, status, stage, first_seen_at, updated_at)
               values ($1,$2,$3,$4,$5,$6,$7,'pending',1,$8,$8)
               on conflict (xt_hash) do update set
                 src_chain   = coalesce(xts.src_chain, excluded.src_chain),
                 dst_chain   = coalesce(xts.dst_chain, excluded.dst_chain),
                 chains      = case when array_length(excluded.chains,1) is not null
                                    then excluded.chains else xts.chains end,
                 sender      = coalesce(xts.sender, excluded.sender),
                 value_wei   = coalesce(xts.value_wei, excluded.value_wei),
                 updated_at  = now()
               returning (xmax = 0)"#,
        )
        .bind(b256_bytes(xt_hash))
        .bind(b256_bytes(instance_id))
        .bind(src_chain)
        .bind(dst_chain)
        .bind(chains)
        .bind(sender.map(address_bytes))
        .bind(value_wei.map(u256_decimal))
        .bind(first_seen)
        .fetch_one(&self.pool)
        .await?;
        Ok(inserted)
    }

    /// Advance an XT to `stage`/`status`, monotonically - an out-of-order or
    /// duplicate event carrying an earlier stage is ignored. The terminal
    /// rollback stage (255) always applies.
    pub async fn advance_xt_stage(
        &self,
        xt_hash: &B256,
        stage: u8,
        status: &str,
    ) -> StoreResult<bool> {
        let res = sqlx::query(
            r#"update xts set stage=$2, status=$3, updated_at=now()
               where xt_hash=$1 and (stage < $2 or $2 = 255)"#,
        )
        .bind(b256_bytes(xt_hash))
        .bind(stage as i16)
        .bind(status)
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
            r#"update xts set stage=255, status='failed', updated_at=now()
               where stage < 6 and status='pending'
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
        instance_id: &B256,
        xt_hash: Option<&B256>,
        participants: &[i32],
        started_at: Option<DateTime<Utc>>,
    ) -> StoreResult<()> {
        sqlx::query(
            r#"insert into instances
                 (instance_id, xt_hash, participants, decision, started_at)
               values ($1,$2,$3,'pending',$4)
               on conflict (instance_id) do update set
                 xt_hash      = coalesce(instances.xt_hash, excluded.xt_hash),
                 participants = case when array_length(excluded.participants,1) is not null
                                     then excluded.participants else instances.participants end,
                 started_at   = coalesce(instances.started_at, excluded.started_at)"#,
        )
        .bind(b256_bytes(instance_id))
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
        instance_id: &B256,
        decision: &str,
        decided_at: DateTime<Utc>,
    ) -> StoreResult<()> {
        sqlx::query(
            r#"update instances
                 set decision=$2, decided_at=coalesce(decided_at, $3)
               where instance_id=$1 and decision='pending'"#,
        )
        .bind(b256_bytes(instance_id))
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
                  xt_hash, chain_id, block_hash, log_index, ts)
               values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
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
        .bind(b256_bytes(m.block_hash))
        .bind(m.log_index)
        .bind(m.ts)
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
        l1_tx: Option<&B256>,
        l1_block: i64,
        proposed_at: DateTime<Utc>,
    ) -> StoreResult<()> {
        sqlx::query(
            r#"insert into superblocks
                 (number, root_claim, hash, parent_hash, l1_tx, l1_block, status, proposed_at)
               values ($1,$2,$3,$4,$5,$6,'proposed',$7)
               on conflict (number) do update set
                 root_claim  = excluded.root_claim,
                 hash        = excluded.hash,
                 parent_hash = excluded.parent_hash,
                 l1_tx       = coalesce(superblocks.l1_tx, excluded.l1_tx),
                 l1_block    = coalesce(superblocks.l1_block, excluded.l1_block),
                 proposed_at = coalesce(superblocks.proposed_at, excluded.proposed_at)"#,
        )
        .bind(number)
        .bind(b256_bytes(root_claim))
        .bind(b256_bytes(hash))
        .bind(b256_bytes(parent_hash))
        .bind(l1_tx.map(b256_bytes))
        .bind(l1_block)
        .bind(proposed_at)
        .execute(&self.pool)
        .await?;
        Ok(())
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
    /// to `Settled` (stage 7). Returns the affected XT hashes so the caller can
    /// publish stream deltas.
    pub async fn attach_and_settle_superblock(
        &self,
        number: i64,
        chains: &[i32],
    ) -> StoreResult<Vec<B256>> {
        let rows: Vec<Vec<u8>> = sqlx::query_scalar(
            r#"update xts set superblock_number=$1, stage=7, status='committed', updated_at=now()
               where superblock_number is null and stage >= 6 and chains && $2::int[]
               returning xt_hash"#,
        )
        .bind(number)
        .bind(chains)
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

    /// All XTs settled in a given superblock, as DTOs.
    pub async fn xts_by_superblock(&self, number: i64) -> StoreResult<Vec<Xt>> {
        let rows = sqlx::query_as::<_, XtRow>(
            "select * from xts where superblock_number=$1 order by updated_at desc",
        )
        .bind(number)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(XtRow::into_dto).collect())
    }

    /// Mark every XT settled in a superblock with the superblock's status
    /// transition, so `committed → validated → finalized` propagates to XTs.
    pub async fn propagate_superblock_status(
        &self,
        number: i64,
        stage: u8,
        status: &str,
    ) -> StoreResult<()> {
        sqlx::query(
            r#"update xts set stage=$2, status=$3, updated_at=now()
               where superblock_number=$1 and (stage < $2 or $2 = 255)"#,
        )
        .bind(number)
        .bind(stage as i16)
        .bind(status)
        .execute(&self.pool)
        .await?;
        Ok(())
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

    /// Drop unsealed flashblock events above the last common ancestor after a
    /// reorg. XTs seen only in dropped pre-confirmations stay `Requested` and
    /// are rolled back by the stall watchdog if they never seal.
    pub async fn rollback_unsealed(&self, chain_id: i32, from_block: i64) -> StoreResult<u64> {
        let dropped = sqlx::query(
            "delete from raw_events where chain_id=$1 and block_number > $2 and safe = false",
        )
        .bind(chain_id)
        .bind(from_block)
        .execute(&self.pool)
        .await?
        .rows_affected();
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

    pub async fn get_instance(&self, instance_id: &B256) -> StoreResult<Option<Instance>> {
        let row = sqlx::query_as::<_, InstanceRow>("select * from instances where instance_id=$1")
            .bind(b256_bytes(instance_id))
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.map(InstanceRow::into_dto))
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
}

/// `bytea` rows to `B256`s, dropping any malformed lengths.
fn b256_list(rows: Vec<Vec<u8>>) -> Vec<B256> {
    rows.into_iter()
        .filter(|b| b.len() == 32)
        .map(|b| B256::from_slice(&b))
        .collect()
}
