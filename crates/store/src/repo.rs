//! Canonical write + read operations. All writes are idempotent so replays,
//! overlapping backfills and duplicate deliveries converge to the same state.

use alloy::primitives::{Address, B256, U256};
use chrono::{DateTime, Utc};
use cross_scout_types::{DomainEvent, Instance, Superblock, Vote, Xt};

use crate::convert::*;
use crate::rows::*;
use crate::{Db, StoreResult};

/// Everything needed to persist one mailbox message.
pub struct MailboxInsert<'a> {
    pub direction: &'a str,
    pub src_chain: Option<i32>,
    pub dst_chain: Option<i32>,
    pub session: Option<&'a B256>,
    pub header: Option<&'a [u8]>,
    pub body_hash: Option<&'a B256>,
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
    /// learn later. Never regresses `stage`/`status`.
    #[expect(
        clippy::too_many_arguments,
        reason = "arg list matches the xts columns; a params struct would not read better"
    )]
    pub async fn ensure_xt(
        &self,
        xt_hash: &B256,
        instance_id: &B256,
        period: Option<i64>,
        seq: Option<i32>,
        src_chain: Option<i32>,
        dst_chain: Option<i32>,
        chains: &[i32],
        sender: Option<&Address>,
        value_wei: Option<&U256>,
        first_seen: DateTime<Utc>,
    ) -> StoreResult<()> {
        sqlx::query(
            r#"insert into xts
                 (xt_hash, instance_id, period, seq, src_chain, dst_chain, chains,
                  sender, value_wei, status, stage, first_seen_at, updated_at)
               values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',1,$10,$10)
               on conflict (xt_hash) do update set
                 instance_id = excluded.instance_id,
                 period      = coalesce(xts.period, excluded.period),
                 seq         = coalesce(xts.seq, excluded.seq),
                 src_chain   = coalesce(xts.src_chain, excluded.src_chain),
                 dst_chain   = coalesce(xts.dst_chain, excluded.dst_chain),
                 chains      = case when array_length(excluded.chains,1) is not null
                                    then excluded.chains else xts.chains end,
                 sender      = coalesce(xts.sender, excluded.sender),
                 value_wei   = coalesce(xts.value_wei, excluded.value_wei),
                 updated_at  = now()"#,
        )
        .bind(b256_bytes(xt_hash))
        .bind(b256_bytes(instance_id))
        .bind(period)
        .bind(seq)
        .bind(src_chain)
        .bind(dst_chain)
        .bind(chains)
        .bind(sender.map(address_bytes))
        .bind(value_wei.map(u256_decimal))
        .bind(first_seen)
        .execute(&self.pool)
        .await?;
        Ok(())
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

    /// Attach an XT to the superblock that settled it.
    pub async fn set_xt_superblock(&self, xt_hash: &B256, number: i64) -> StoreResult<()> {
        sqlx::query("update xts set superblock_number=$2, updated_at=now() where xt_hash=$1")
            .bind(b256_bytes(xt_hash))
            .bind(number)
            .execute(&self.pool)
            .await?;
        Ok(())
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

    // ── instances + votes ─────────────────────────────────────────

    pub async fn upsert_instance(
        &self,
        instance_id: &B256,
        xt_hash: Option<&B256>,
        period: Option<i64>,
        seq: Option<i32>,
        participants: &[i32],
        started_at: Option<DateTime<Utc>>,
    ) -> StoreResult<()> {
        sqlx::query(
            r#"insert into instances
                 (instance_id, xt_hash, period, seq, participants, decision, started_at)
               values ($1,$2,$3,$4,$5,'pending',$6)
               on conflict (instance_id) do update set
                 xt_hash      = coalesce(instances.xt_hash, excluded.xt_hash),
                 period       = coalesce(instances.period, excluded.period),
                 seq          = coalesce(instances.seq, excluded.seq),
                 participants = case when array_length(excluded.participants,1) is not null
                                     then excluded.participants else instances.participants end,
                 started_at   = coalesce(instances.started_at, excluded.started_at)"#,
        )
        .bind(b256_bytes(instance_id))
        .bind(xt_hash.map(b256_bytes))
        .bind(period)
        .bind(seq)
        .bind(participants)
        .bind(started_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn set_instance_decision(
        &self,
        instance_id: &B256,
        decision: &str,
        decided_at: DateTime<Utc>,
    ) -> StoreResult<()> {
        sqlx::query("update instances set decision=$2, decided_at=$3 where instance_id=$1")
            .bind(b256_bytes(instance_id))
            .bind(decision)
            .bind(decided_at)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn record_vote(
        &self,
        instance_id: &B256,
        chain_id: i32,
        commit: bool,
        voted_at: DateTime<Utc>,
    ) -> StoreResult<()> {
        sqlx::query(
            r#"insert into votes (instance_id, chain_id, commit_vote, voted_at)
               values ($1,$2,$3,$4)
               on conflict (instance_id, chain_id) do update set
                 commit_vote = excluded.commit_vote, voted_at = excluded.voted_at"#,
        )
        .bind(b256_bytes(instance_id))
        .bind(chain_id)
        .bind(commit)
        .bind(voted_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// The XT a given instance belongs to, once `InstanceStarted` has linked
    /// them. Votes/decisions carry only `instance_id`, so correlation resolves
    /// the XT through this.
    pub async fn xt_hash_for_instance(&self, instance_id: &B256) -> StoreResult<Option<B256>> {
        let row: Option<Option<Vec<u8>>> =
            sqlx::query_scalar("select xt_hash from instances where instance_id=$1")
                .bind(b256_bytes(instance_id))
                .fetch_optional(&self.pool)
                .await?;
        Ok(row
            .flatten()
            .filter(|b| b.len() == 32)
            .map(|b| B256::from_slice(&b)))
    }

    // ── mailbox ───────────────────────────────────────────────────

    pub async fn insert_mailbox(&self, m: MailboxInsert<'_>) -> StoreResult<()> {
        sqlx::query(
            r#"insert into mailbox_messages
                 (direction, src_chain, dst_chain, session, header, body_hash,
                  xt_hash, chain_id, block_hash, log_index, ts)
               values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
               on conflict (chain_id, block_hash, log_index) do nothing"#,
        )
        .bind(m.direction)
        .bind(m.src_chain)
        .bind(m.dst_chain)
        .bind(m.session.map(b256_bytes))
        .bind(m.header.map(|h| h.to_vec()))
        .bind(m.body_hash.map(b256_bytes))
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

    pub async fn upsert_superblock_proposed(
        &self,
        number: i64,
        mailbox_root: &B256,
        period: Option<i64>,
        proposed_at: DateTime<Utc>,
    ) -> StoreResult<()> {
        sqlx::query(
            r#"insert into superblocks (number, mailbox_root, period, status, proposed_at)
               values ($1,$2,$3,'proposed',$4)
               on conflict (number) do update set
                 mailbox_root = excluded.mailbox_root,
                 period       = coalesce(superblocks.period, excluded.period),
                 proposed_at  = coalesce(superblocks.proposed_at, excluded.proposed_at)"#,
        )
        .bind(number)
        .bind(b256_bytes(mailbox_root))
        .bind(period)
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

    pub async fn set_superblock_finalized(
        &self,
        number: i64,
        l1_tx: &B256,
        l1_block: i64,
        finalized_at: DateTime<Utc>,
    ) -> StoreResult<()> {
        sqlx::query(
            r#"update superblocks
                 set status='finalized', l1_tx=$2, l1_block=$3,
                     finalized_at = coalesce(finalized_at, $4)
               where number=$1"#,
        )
        .bind(number)
        .bind(b256_bytes(l1_tx))
        .bind(l1_block)
        .bind(finalized_at)
        .execute(&self.pool)
        .await?;
        Ok(())
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
            r#"update xts set superblock_number=$1, stage=7, status='unsafe', updated_at=now()
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
        Ok(rows
            .into_iter()
            .filter(|b| b.len() == 32)
            .map(|b| B256::from_slice(&b))
            .collect())
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

    /// Count XTs that have sat below `Decided` (stage 5) longer than one period
    /// - the correlation watchdog's stall signal.
    pub async fn count_stalled(&self, period_seconds: i64) -> StoreResult<i64> {
        let n: i64 = sqlx::query_scalar(
            r#"select count(*) from xts
               where stage < 5 and status = 'pending'
                 and first_seen_at < now() - make_interval(secs => $1)"#,
        )
        .bind(period_seconds as f64)
        .fetch_one(&self.pool)
        .await?;
        Ok(n)
    }

    /// Mark every XT settled in a superblock with the superblock's status
    /// transition, so `unsafe → validated → finalized` propagates to XTs.
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

    /// Drop unsafe (flashblock) events above the last common ancestor after a
    /// reorg, and roll any XTs that were only `Included` on those blocks back to
    /// `Decided` so they can be re-included on the canonical chain.
    pub async fn rollback_unsafe(&self, chain_id: i32, from_block: i64) -> StoreResult<u64> {
        let mut tx = self.pool.begin().await?;
        let dropped = sqlx::query(
            "delete from raw_events where chain_id=$1 and block_number > $2 and safe = false",
        )
        .bind(chain_id)
        .bind(from_block)
        .execute(&mut *tx)
        .await?
        .rows_affected();

        // Included(6) reverts to Decided(5) for XTs on this chain that never
        // reached a safe superblock. Settled+ XTs are anchored on L1 and kept.
        sqlx::query(
            r#"update xts set stage=5, status='pending', updated_at=now()
               where stage = 6 and $1 = any(chains)"#,
        )
        .bind(chain_id)
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

    pub async fn get_votes(&self, instance_id: &B256) -> StoreResult<Vec<Vote>> {
        let rows = sqlx::query_as::<_, VoteRow>(
            "select * from votes where instance_id=$1 order by chain_id",
        )
        .bind(b256_bytes(instance_id))
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(VoteRow::into_dto).collect())
    }

    pub async fn get_instance(&self, instance_id: &B256) -> StoreResult<Option<Instance>> {
        let row = sqlx::query_as::<_, InstanceRow>("select * from instances where instance_id=$1")
            .bind(b256_bytes(instance_id))
            .fetch_optional(&self.pool)
            .await?;
        match row {
            Some(r) => {
                let votes = self.get_votes(instance_id).await?;
                Ok(Some(r.into_dto(votes)))
            }
            None => Ok(None),
        }
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
