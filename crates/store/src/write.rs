//! Store write models used by repository operations.

use alloy::primitives::{Address, B256, U256};
use chrono::{DateTime, Utc};

/// Canonical identity facts for an XT.
#[derive(Debug, Clone, Copy)]
pub struct XtIdentity<'a> {
    pub src_chain: i32,
    pub dst_chain: i32,
    pub sender: &'a Address,
    pub receiver: &'a Address,
    pub label: Option<&'a str>,
}

impl<'a> XtIdentity<'a> {
    pub fn new(
        src_chain: i32,
        dst_chain: i32,
        sender: &'a Address,
        receiver: &'a Address,
        label: Option<&'a str>,
    ) -> Self {
        Self {
            src_chain,
            dst_chain,
            sender,
            receiver,
            label,
        }
    }
}

/// One observation that can create an XT row or fill first-write-wins facts.
pub struct XtObservation<'a> {
    pub(crate) xt_hash: &'a B256,
    participants: ParticipantChains,
    pub(crate) identity: Option<XtIdentity<'a>>,
    pub(crate) value_wei: Option<&'a U256>,
    pub(crate) src_tx_hash: Option<&'a B256>,
    pub(crate) first_seen: DateTime<Utc>,
}

impl<'a> XtObservation<'a> {
    pub fn new(
        xt_hash: &'a B256,
        src_chain: i32,
        dst_chain: i32,
        identity: Option<XtIdentity<'a>>,
        value_wei: Option<&'a U256>,
        src_tx_hash: Option<&'a B256>,
        first_seen: DateTime<Utc>,
    ) -> Self {
        Self {
            xt_hash,
            participants: ParticipantChains::new(src_chain, dst_chain),
            identity,
            value_wei,
            src_tx_hash,
            first_seen,
        }
    }

    pub fn participants(&self) -> &[i32] {
        self.participants.as_slice()
    }
}

#[derive(Debug, Clone, Copy)]
struct ParticipantChains([i32; 2]);

impl ParticipantChains {
    fn new(a: i32, b: i32) -> Self {
        if a <= b {
            Self([a, b])
        } else {
            Self([b, a])
        }
    }

    fn as_slice(&self) -> &[i32] {
        &self.0
    }
}

/// Persisted effect of applying one XT observation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum XtObservationEffect {
    Inserted,
    Extended,
    Unchanged,
}

impl XtObservationEffect {
    pub(crate) fn from_insert_return(inserted: Option<bool>) -> Self {
        match inserted {
            Some(true) => Self::Inserted,
            Some(false) => Self::Extended,
            None => Self::Unchanged,
        }
    }
}

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
    pub block_number: Option<i64>,
    pub block_hash: &'a B256,
    pub log_index: i32,
    pub tx_hash: Option<&'a B256>,
    pub gas_used: Option<&'a U256>,
    pub effective_gas_price_wei: Option<&'a U256>,
    pub ts: DateTime<Utc>,
}

/// Everything needed to persist one source-leg asset transfer.
pub struct TransferInsert<'a> {
    pub session: &'a B256,
    /// `eth` for native transfers, `erc20` for token transfers.
    pub kind: &'a str,
    /// Token address for `erc20`, `None` for native ETH.
    pub token: Option<&'a Address>,
    pub amount: &'a U256,
    pub src_chain: i32,
    pub dst_chain: i32,
    pub sender: &'a Address,
    pub receiver: &'a Address,
    pub message_id: Option<&'a B256>,
    pub chain_id: i32,
    pub block_number: Option<i64>,
    pub block_hash: &'a B256,
    pub log_index: i32,
    pub tx_hash: Option<&'a B256>,
    pub safe: bool,
    pub ts: DateTime<Utc>,
}

/// L1 portal `TransactionDeposited` observation.
pub struct DepositInsert<'a> {
    pub source_hash: &'a B256,
    pub l2_chain_id: i32,
    pub sender: &'a Address,
    pub receiver: &'a Address,
    pub mint: &'a U256,
    pub value: &'a U256,
    pub gas_limit: u64,
    pub is_creation: bool,
    pub l1_chain_id: i32,
    pub l1_block_number: i64,
    pub l1_block_hash: &'a B256,
    pub l1_log_index: i32,
    pub l1_tx_hash: Option<&'a B256>,
    pub ts: DateTime<Utc>,
}

/// L2 `MessagePassed` withdrawal initiation.
pub struct WithdrawalInitiatedInsert<'a> {
    pub withdrawal_hash: &'a B256,
    pub l2_chain_id: i32,
    pub nonce: &'a U256,
    pub sender: &'a Address,
    pub target: &'a Address,
    pub value: &'a U256,
    pub gas_limit: &'a U256,
    pub chain_id: i32,
    pub block_number: i64,
    pub block_hash: &'a B256,
    pub log_index: i32,
    pub tx_hash: Option<&'a B256>,
    pub ts: DateTime<Utc>,
}

/// L1 portal `WithdrawalProven` observation.
pub struct WithdrawalProvenInsert<'a> {
    pub withdrawal_hash: &'a B256,
    pub l2_chain_id: i32,
    pub l1_chain_id: i32,
    pub l1_block_number: i64,
    pub l1_block_hash: &'a B256,
    pub l1_log_index: i32,
    pub l1_tx_hash: Option<&'a B256>,
    pub ts: DateTime<Utc>,
}

/// L1 portal `WithdrawalFinalized` observation.
pub struct WithdrawalFinalizedInsert<'a> {
    pub withdrawal_hash: &'a B256,
    pub l2_chain_id: i32,
    pub success: bool,
    pub l1_chain_id: i32,
    pub l1_block_number: i64,
    pub l1_block_hash: &'a B256,
    pub l1_log_index: i32,
    pub l1_tx_hash: Option<&'a B256>,
    pub ts: DateTime<Utc>,
}

#[cfg(test)]
mod tests {
    use alloy::primitives::{Address, B256};
    use chrono::Utc;

    use super::{XtIdentity, XtObservation};

    #[test]
    fn observation_participants_are_canonicalized_as_a_set() {
        let xt_hash = B256::repeat_byte(0x11);
        let sender = Address::repeat_byte(0x22);
        let receiver = Address::repeat_byte(0x33);

        let obs = XtObservation::new(
            &xt_hash,
            10,
            2,
            Some(XtIdentity::new(
                10,
                2,
                &sender,
                &receiver,
                Some("eth-transfer"),
            )),
            None,
            None,
            Utc::now(),
        );

        assert_eq!(obs.participants(), &[2, 10]);
        assert_eq!(obs.identity.expect("identity").src_chain, 10);
    }
}
