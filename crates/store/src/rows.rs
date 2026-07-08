//! `sqlx::FromRow` shapes for the canonical tables and their mapping into the
//! DTOs the api and the Redis stream carry. Read queries in [`crate::repo`]
//! select into these, then call `into_dto`.

use crate::convert::*;
use bigdecimal::BigDecimal;
use chrono::{DateTime, Utc};
use cross_scout_types::{
    Decision, Direction, Instance, MailboxMessage, Superblock, SuperblockChain, SuperblockStatus,
    TokenMeta, Transfer, TxFee, Xt, XtStatus,
};

fn xt_status(s: &str) -> XtStatus {
    match s {
        "committed" => XtStatus::Committed,
        "validated" => XtStatus::Validated,
        "finalized" => XtStatus::Finalized,
        "failed" => XtStatus::Failed,
        _ => XtStatus::Pending,
    }
}

fn decision(s: &str) -> Decision {
    match s {
        "commit" => Decision::Commit,
        "abort" => Decision::Abort,
        _ => Decision::Pending,
    }
}

fn direction(s: &str) -> Direction {
    match s {
        "in" => Direction::In,
        _ => Direction::Out,
    }
}

fn superblock_status(s: &str) -> SuperblockStatus {
    match s {
        "validated" => SuperblockStatus::Validated,
        "finalized" => SuperblockStatus::Finalized,
        _ => SuperblockStatus::Proposed,
    }
}

fn tx_fee(
    gas_used: &Option<BigDecimal>,
    effective_gas_price_wei: &Option<BigDecimal>,
    fee_wei: &Option<BigDecimal>,
) -> Option<TxFee> {
    Some(TxFee {
        gas_used: decimal_string(gas_used.as_ref()?),
        effective_gas_price_wei: decimal_string(effective_gas_price_wei.as_ref()?),
        fee_wei: decimal_string(fee_wei.as_ref()?),
        fee_usd: None,
    })
}

#[derive(sqlx::FromRow)]
pub struct XtRow {
    pub xt_hash: Vec<u8>,
    pub src_chain: Option<i32>,
    pub dst_chain: Option<i32>,
    pub chains: Vec<i32>,
    pub sender: Option<Vec<u8>>,
    pub receiver: Option<Vec<u8>>,
    pub label: Option<String>,
    pub value_wei: Option<BigDecimal>,
    pub status: String,
    pub stage: i16,
    pub superblock_number: Option<i64>,
    pub src_tx_hash: Option<Vec<u8>>,
    pub first_seen_at: DateTime<Utc>,
    pub preconfirmed_at: Option<DateTime<Utc>>,
    pub included_at: Option<DateTime<Utc>>,
    pub settled_at: Option<DateTime<Utc>>,
    pub finalized_at: Option<DateTime<Utc>>,
    pub failed_at: Option<DateTime<Utc>>,
    pub updated_at: DateTime<Utc>,
}

impl XtRow {
    pub fn into_dto(self) -> Xt {
        Xt {
            xt_hash: hex_prefixed(&self.xt_hash),
            src_chain: self.src_chain,
            dst_chain: self.dst_chain,
            chains: self.chains,
            sender: opt_hex(&self.sender),
            receiver: opt_hex(&self.receiver),
            label: self.label,
            value_wei: self.value_wei.as_ref().map(decimal_string),
            value_usd: None,
            status: xt_status(&self.status),
            stage: self.stage.clamp(0, 255) as u8,
            superblock_number: self.superblock_number,
            src_tx_hash: opt_hex(&self.src_tx_hash),
            first_seen_at: rfc3339(&self.first_seen_at),
            preconfirmed_at: opt_rfc3339(&self.preconfirmed_at),
            included_at: opt_rfc3339(&self.included_at),
            settled_at: opt_rfc3339(&self.settled_at),
            finalized_at: opt_rfc3339(&self.finalized_at),
            failed_at: opt_rfc3339(&self.failed_at),
            updated_at: rfc3339(&self.updated_at),
        }
    }
}

#[derive(sqlx::FromRow)]
pub struct InstanceRow {
    pub session: Vec<u8>,
    pub xt_hash: Option<Vec<u8>>,
    pub participants: Vec<i32>,
    pub decision: String,
    pub started_at: Option<DateTime<Utc>>,
    pub decided_at: Option<DateTime<Utc>>,
}

impl InstanceRow {
    pub fn into_dto(self) -> Instance {
        Instance {
            session: hex_prefixed(&self.session),
            xt_hash: opt_hex(&self.xt_hash),
            participants: self.participants,
            decision: decision(&self.decision),
            started_at: opt_rfc3339(&self.started_at),
            decided_at: opt_rfc3339(&self.decided_at),
        }
    }
}

#[derive(sqlx::FromRow)]
pub struct MailboxRow {
    pub id: i64,
    pub direction: String,
    pub src_chain: Option<i32>,
    pub dst_chain: Option<i32>,
    pub session: Option<Vec<u8>>,
    pub sender: Option<Vec<u8>>,
    pub receiver: Option<Vec<u8>>,
    pub label: Option<String>,
    pub xt_hash: Option<Vec<u8>>,
    pub superblock_number: Option<i64>,
    pub chain_id: i32,
    pub block_hash: Vec<u8>,
    pub log_index: i32,
    pub tx_hash: Option<Vec<u8>>,
    pub gas_used: Option<BigDecimal>,
    pub effective_gas_price_wei: Option<BigDecimal>,
    pub fee_wei: Option<BigDecimal>,
    pub ts: DateTime<Utc>,
}

impl MailboxRow {
    pub fn into_dto(self) -> MailboxMessage {
        MailboxMessage {
            id: self.id,
            direction: direction(&self.direction),
            src_chain: self.src_chain,
            dst_chain: self.dst_chain,
            session: opt_hex(&self.session),
            sender: opt_hex(&self.sender),
            receiver: opt_hex(&self.receiver),
            label: self.label,
            xt_hash: opt_hex(&self.xt_hash),
            superblock_number: self.superblock_number,
            chain_id: self.chain_id,
            block_hash: hex_prefixed(&self.block_hash),
            log_index: self.log_index,
            tx_hash: opt_hex(&self.tx_hash),
            tx_fee: tx_fee(&self.gas_used, &self.effective_gas_price_wei, &self.fee_wei),
            ts: rfc3339(&self.ts),
        }
    }
}

#[derive(sqlx::FromRow)]
pub struct TransferRow {
    pub id: i64,
    pub session: Vec<u8>,
    pub kind: String,
    pub token: Option<Vec<u8>>,
    pub amount: BigDecimal,
    pub src_chain: i32,
    pub dst_chain: i32,
    pub sender: Vec<u8>,
    pub receiver: Vec<u8>,
    pub message_id: Option<Vec<u8>>,
    pub chain_id: i32,
    pub tx_hash: Option<Vec<u8>>,
    pub safe: bool,
    pub ts: DateTime<Utc>,
}

impl TransferRow {
    pub fn into_dto(self) -> Transfer {
        Transfer {
            id: self.id,
            session: hex_prefixed(&self.session),
            kind: self.kind,
            token: opt_hex(&self.token),
            amount: decimal_string(&self.amount),
            amount_usd: None,
            src_chain: self.src_chain,
            dst_chain: self.dst_chain,
            sender: hex_prefixed(&self.sender),
            receiver: hex_prefixed(&self.receiver),
            message_id: opt_hex(&self.message_id),
            chain_id: self.chain_id,
            tx_hash: opt_hex(&self.tx_hash),
            safe: self.safe,
            ts: rfc3339(&self.ts),
        }
    }
}

#[derive(sqlx::FromRow)]
pub struct TokenRow {
    pub chain_id: i32,
    pub address: Vec<u8>,
    pub symbol: Option<String>,
    pub name: Option<String>,
    pub decimals: Option<i32>,
}

impl TokenRow {
    pub fn into_dto(self) -> TokenMeta {
        TokenMeta {
            chain_id: self.chain_id,
            address: hex_prefixed(&self.address),
            symbol: self.symbol,
            name: self.name,
            decimals: self.decimals,
        }
    }
}

#[derive(sqlx::FromRow)]
pub struct SuperblockChainRow {
    pub superblock_number: i64,
    pub chain_id: i32,
    pub l2_block: Option<i64>,
    pub pre_root: Option<Vec<u8>>,
    pub post_root: Option<Vec<u8>>,
    pub config_hash: Option<Vec<u8>>,
}

impl SuperblockChainRow {
    pub fn into_dto(self) -> SuperblockChain {
        SuperblockChain {
            superblock_number: self.superblock_number,
            chain_id: self.chain_id,
            l2_block: self.l2_block,
            pre_root: opt_hex(&self.pre_root),
            post_root: opt_hex(&self.post_root),
            config_hash: opt_hex(&self.config_hash),
        }
    }
}

#[derive(sqlx::FromRow)]
pub struct SuperblockRow {
    pub number: i64,
    pub hash: Option<Vec<u8>>,
    pub parent_hash: Option<Vec<u8>>,
    pub status: String,
    pub root_claim: Option<Vec<u8>>,
    pub game_address: Option<Vec<u8>>,
    pub xt_count: i32,
    pub prove_ms: Option<i32>,
    pub l1_tx: Option<Vec<u8>>,
    pub l1_block: Option<i64>,
    pub l1_gas_used: Option<BigDecimal>,
    pub l1_effective_gas_price_wei: Option<BigDecimal>,
    pub l1_fee_wei: Option<BigDecimal>,
    pub proposed_at: Option<DateTime<Utc>>,
    pub validated_at: Option<DateTime<Utc>>,
    pub finalized_at: Option<DateTime<Utc>>,
}

impl SuperblockRow {
    pub fn into_dto(self, chains: Vec<SuperblockChain>) -> Superblock {
        Superblock {
            number: self.number,
            hash: opt_hex(&self.hash),
            parent_hash: opt_hex(&self.parent_hash),
            status: superblock_status(&self.status),
            root_claim: opt_hex(&self.root_claim),
            game_address: opt_hex(&self.game_address),
            xt_count: self.xt_count,
            prove_ms: self.prove_ms,
            l1_tx: opt_hex(&self.l1_tx),
            l1_block: self.l1_block,
            l1_tx_fee: tx_fee(&self.l1_gas_used, &self.l1_effective_gas_price_wei, &self.l1_fee_wei),
            proposed_at: opt_rfc3339(&self.proposed_at),
            validated_at: opt_rfc3339(&self.validated_at),
            finalized_at: opt_rfc3339(&self.finalized_at),
            chains,
        }
    }
}
