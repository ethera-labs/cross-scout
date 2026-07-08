//! OP Stack bridge ingestion: L1-to-L2 deposits and L2-to-L1 withdrawals.
//!
//! Two sources cover the observable legs:
//!
//! * [`L1PortalSource`] polls every configured rollup portal on L1 for
//!   `TransactionDeposited` (deposit initiated), `WithdrawalProven` and
//!   `WithdrawalFinalized` logs. The emitting portal identifies the rollup.
//! * [`L2BridgeSource`] polls a rollup's `L2ToL1MessagePasser` predeploy for
//!   `MessagePassed` (withdrawal initiated).
//!
//! Withdrawal legs join on the `withdrawalHash` every event carries. A deposit
//! is identified by its source hash, derived from the L1 log coordinates.

use alloy::primitives::{address, keccak256, Address, B256, U256};
use alloy::providers::DynProvider;
use alloy::rpc::types::{Filter, Log};
use alloy::sol;
use alloy::sol_types::SolEvent;
use async_trait::async_trait;
use cross_scout_ingest_el::evm::{meta_of, poll_logs, topic0, LogDecoder, PollConfig};
use cross_scout_types::{DomainEvent, EventKind, EventSink, Source, SourceError};
use tracing::warn;

/// The `L2ToL1MessagePasser` predeploy, fixed across OP Stack rollups.
pub const MESSAGE_PASSER: Address = address!("4200000000000000000000000000000000000016");

sol! {
    interface IOptimismPortal {
        event TransactionDeposited(address indexed from, address indexed to,
            uint256 indexed version, bytes opaqueData);
        event WithdrawalProven(bytes32 indexed withdrawalHash, address indexed from,
            address indexed to);
        event WithdrawalFinalized(bytes32 indexed withdrawalHash, bool success);
    }

    interface IL2ToL1MessagePasser {
        event MessagePassed(uint256 indexed nonce, address indexed sender,
            address indexed target, uint256 value, uint256 gasLimit, bytes data,
            bytes32 withdrawalHash);
    }
}

/// Packed fields of a version-0 `TransactionDeposited.opaqueData`:
/// `mint(u256) ++ value(u256) ++ gasLimit(u64) ++ isCreation(u8) ++ data`.
struct DepositFields {
    mint: U256,
    value: U256,
    gas_limit: u64,
    is_creation: bool,
}

fn unpack_opaque_data(data: &[u8]) -> Option<DepositFields> {
    if data.len() < 73 {
        return None;
    }
    Some(DepositFields {
        mint: U256::from_be_slice(&data[0..32]),
        value: U256::from_be_slice(&data[32..64]),
        gas_limit: u64::from_be_bytes(data[64..72].try_into().ok()?),
        is_creation: data[72] != 0,
    })
}

/// User-deposit source hash:
/// `keccak(domain ++ keccak(l1_block_hash ++ l1_log_index))` with domain 0.
/// The value identifies the deposit and derives the corresponding L2 transaction.
fn deposit_source_hash(l1_block_hash: &B256, log_index: u64) -> B256 {
    let mut inner = [0u8; 64];
    inner[..32].copy_from_slice(l1_block_hash.as_slice());
    inner[56..].copy_from_slice(&log_index.to_be_bytes());
    let inner_hash = keccak256(inner);
    let mut outer = [0u8; 64];
    outer[32..].copy_from_slice(inner_hash.as_slice());
    keccak256(outer)
}

/// One rollup's `OptimismPortal` contract on L1.
#[derive(Clone, Debug)]
pub struct PortalEndpoint {
    pub l2_chain_id: i32,
    pub address: Address,
}

struct PortalDecoder {
    l1_chain_id: i32,
    portals: Vec<PortalEndpoint>,
}

impl PortalDecoder {
    fn l2_chain(&self, portal: &Address) -> Option<i32> {
        self.portals
            .iter()
            .find(|p| p.address == *portal)
            .map(|p| p.l2_chain_id)
    }
}

#[async_trait]
impl LogDecoder for PortalDecoder {
    fn filter(&self) -> Filter {
        let addresses: Vec<Address> = self.portals.iter().map(|p| p.address).collect();
        Filter::new().address(addresses)
    }

    async fn decode(&self, _provider: &DynProvider, log: &Log) -> Vec<DomainEvent> {
        let Some(t0) = topic0(log) else {
            return Vec::new();
        };
        let Some(l2_chain_id) = self.l2_chain(&log.inner.address) else {
            return Vec::new();
        };

        let kind = if t0 == IOptimismPortal::TransactionDeposited::SIGNATURE_HASH {
            let Ok(ev) = IOptimismPortal::TransactionDeposited::decode_log(&log.inner) else {
                return Vec::new();
            };
            if ev.version != U256::ZERO {
                warn!(version = %ev.version, "unsupported deposit version; skipping");
                return Vec::new();
            }
            let Some(fields) = unpack_opaque_data(&ev.opaqueData) else {
                warn!(tx = ?log.transaction_hash, "malformed deposit opaqueData; skipping");
                return Vec::new();
            };
            let (Some(block_hash), Some(log_index)) = (log.block_hash, log.log_index) else {
                return Vec::new();
            };
            EventKind::DepositInitiated {
                source_hash: deposit_source_hash(&block_hash, log_index),
                l2_chain_id,
                sender: ev.from,
                receiver: ev.to,
                mint: fields.mint,
                value: fields.value,
                gas_limit: fields.gas_limit,
                is_creation: fields.is_creation,
            }
        } else if t0 == IOptimismPortal::WithdrawalProven::SIGNATURE_HASH {
            let Ok(ev) = IOptimismPortal::WithdrawalProven::decode_log(&log.inner) else {
                return Vec::new();
            };
            EventKind::WithdrawalProven {
                withdrawal_hash: ev.withdrawalHash,
                l2_chain_id,
            }
        } else if t0 == IOptimismPortal::WithdrawalFinalized::SIGNATURE_HASH {
            let Ok(ev) = IOptimismPortal::WithdrawalFinalized::decode_log(&log.inner) else {
                return Vec::new();
            };
            EventKind::WithdrawalFinalized {
                withdrawal_hash: ev.withdrawalHash,
                l2_chain_id,
                success: ev.success,
            }
        } else {
            return Vec::new();
        };

        vec![DomainEvent::new(meta_of(self.l1_chain_id, log, true), kind)]
    }
}

/// Polls every configured rollup portal on L1 for deposit and withdrawal legs.
pub struct L1PortalSource {
    cfg: PollConfig,
    decoder: PortalDecoder,
}

/// Configuration for L1 portal ingestion.
#[derive(Clone, Debug)]
pub struct L1PortalSourceConfig {
    pub l1_chain_id: i32,
    pub l1_rpc_url: String,
    pub portals: Vec<PortalEndpoint>,
    pub start_block: Option<u64>,
    pub poll_ms: u64,
    pub max_range: u64,
}

impl L1PortalSource {
    pub fn new(cfg: L1PortalSourceConfig) -> Self {
        Self {
            cfg: PollConfig {
                name: "ingest-bridge-l1",
                rpc_url: cfg.l1_rpc_url,
                chain_id: cfg.l1_chain_id,
                start_block: cfg.start_block,
                poll_ms: cfg.poll_ms,
                // This source does not emit L1 head events; portal rows are
                // updated only from observed portal logs.
                track_heads: false,
                max_range: cfg.max_range,
            },
            decoder: PortalDecoder {
                l1_chain_id: cfg.l1_chain_id,
                portals: cfg.portals,
            },
        }
    }
}

#[async_trait]
impl Source for L1PortalSource {
    fn name(&self) -> &'static str {
        "ingest-bridge-l1"
    }

    async fn run(self: Box<Self>, sink: EventSink) -> Result<(), SourceError> {
        poll_logs(self.cfg, sink, self.decoder).await
    }
}

struct MessagePasserDecoder {
    chain_id: i32,
}

#[async_trait]
impl LogDecoder for MessagePasserDecoder {
    fn filter(&self) -> Filter {
        Filter::new()
            .address(MESSAGE_PASSER)
            .event_signature(IL2ToL1MessagePasser::MessagePassed::SIGNATURE_HASH)
    }

    async fn decode(&self, _provider: &DynProvider, log: &Log) -> Vec<DomainEvent> {
        if topic0(log) != Some(IL2ToL1MessagePasser::MessagePassed::SIGNATURE_HASH) {
            return Vec::new();
        }
        let Ok(ev) = IL2ToL1MessagePasser::MessagePassed::decode_log(&log.inner) else {
            return Vec::new();
        };
        vec![DomainEvent::new(
            meta_of(self.chain_id, log, true),
            EventKind::WithdrawalInitiated {
                withdrawal_hash: ev.withdrawalHash,
                l2_chain_id: self.chain_id,
                nonce: ev.nonce,
                sender: ev.sender,
                target: ev.target,
                value: ev.value,
                gas_limit: ev.gasLimit,
            },
        )]
    }
}

/// Polls one rollup's `L2ToL1MessagePasser` for withdrawal initiations. The
/// rollup EL source already emits the head events used for reorg handling.
pub struct L2BridgeSource {
    cfg: PollConfig,
    decoder: MessagePasserDecoder,
}

impl L2BridgeSource {
    pub fn new(
        chain_id: i32,
        rpc_url: String,
        start_block: Option<u64>,
        poll_ms: u64,
        max_range: u64,
    ) -> Self {
        Self {
            cfg: PollConfig {
                name: "ingest-bridge-l2",
                rpc_url,
                chain_id,
                start_block,
                poll_ms,
                track_heads: false,
                max_range,
            },
            decoder: MessagePasserDecoder { chain_id },
        }
    }
}

#[async_trait]
impl Source for L2BridgeSource {
    fn name(&self) -> &'static str {
        "ingest-bridge-l2"
    }

    async fn run(self: Box<Self>, sink: EventSink) -> Result<(), SourceError> {
        poll_logs(self.cfg, sink, self.decoder).await
    }
}
