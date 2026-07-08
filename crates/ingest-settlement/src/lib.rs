//! L1 settlement ingestion. The publisher settles each superblock by creating
//! a compose-type dispute game on the `DisputeGameFactory`; the resolved game
//! is anchored in the `ComposeAnchorStateRegistry`. Two sources cover that:
//!
//! * [`SettlementSource`] polls the factory's `DisputeGameCreated` logs,
//!   decodes the `create()` calldata (`extraData` = ABI-encoded aggregation
//!   outputs + super-root proof) and emits `SuperblockProposed` with the
//!   per-chain state transitions.
//! * [`AnchorSource`] polls the registry's `getAnchorRoot()` view and emits
//!   `SuperblockFinalized` whenever the anchored superblock number advances.

use std::time::Duration;

use alloy::consensus::Transaction;
use alloy::primitives::{keccak256, Address, Bytes, B256};
use alloy::providers::{DynProvider, Provider, ProviderBuilder};
use alloy::rpc::types::{Filter, Log};
use alloy::sol;
use alloy::sol_types::{SolCall, SolEvent, SolValue};
use async_trait::async_trait;
use cross_scout_ingest_el::chain_i32;
use cross_scout_ingest_el::evm::{meta_with_receipt, poll_logs, topic0, LogDecoder, PollConfig};
use cross_scout_types::event::ChainTransition;
use cross_scout_types::{
    DomainEvent, EventKind, EventMeta, EventSink, SinkClosed, Source, SourceError,
};
use tracing::{debug, warn};

// `create(gameType, rootClaim, extraData)` carries the superblock payload in
// `extraData`, params-encoded as `(SuperblockAggregationOutputs,
// SuperRootProof, bytes proof)`.
sol! {
    interface IDisputeGameFactory {
        event DisputeGameCreated(address indexed disputeProxy, uint32 indexed gameType,
            bytes32 indexed rootClaim);
        function create(uint32 _gameType, bytes32 _rootClaim, bytes calldata _extraData)
            external payable returns (address proxy_);
    }

    #[sol(rpc)]
    interface IComposeAnchorStateRegistry {
        function getAnchorRoot() external view returns (bytes32 root_, uint256 l2SequenceNumber_);
    }

    struct BootInfoStruct {
        bytes32 l1Head;
        bytes32 l2PreRoot;
        bytes32 l2PostRoot;
        uint64 l2BlockNumber;
        bytes32 rollupConfigHash;
    }

    struct SuperblockAggregationOutputs {
        uint256 superblockNumber;
        bytes32 parentSuperblockBatchHash;
        BootInfoStruct[] bootInfo;
    }

    struct OutputRootWithChainId {
        uint256 chainId;
        bytes32 root;
    }

    struct SuperRootProof {
        bytes1 version;
        uint64 timestamp;
        OutputRootWithChainId[] outputRoots;
    }
}

/// Decode the superblock payload out of a `create()` call's calldata.
/// `game_address` is the dispute game proxy the factory emitted in the
/// `DisputeGameCreated` event (the calldata itself never carries it). Returns
/// `None` for foreign game types or undecodable extra data.
pub fn decode_create_calldata(
    input: &[u8],
    game_type: u32,
    game_address: Address,
) -> Option<EventKind> {
    let call = IDisputeGameFactory::createCall::abi_decode(input).ok()?;
    if call._gameType != game_type {
        return None;
    }

    let (outputs, proof, _proof_bytes): (SuperblockAggregationOutputs, SuperRootProof, Bytes) =
        SolValue::abi_decode_params(&call._extraData).ok()?;

    // `bootInfo` and `outputRoots` are built pairwise by the publisher, so
    // index i of both describes the same rollup.
    let transitions: Vec<ChainTransition> = outputs
        .bootInfo
        .iter()
        .zip(proof.outputRoots.iter())
        .map(|(boot, root)| ChainTransition {
            chain_id: chain_i32(root.chainId),
            l2_block: boot.l2BlockNumber as i64,
            pre_root: boot.l2PreRoot,
            post_root: boot.l2PostRoot,
            config_hash: boot.rollupConfigHash,
        })
        .collect();
    let chains: Vec<i32> = transitions.iter().map(|t| t.chain_id).collect();

    Some(EventKind::SuperblockProposed {
        number: i64::try_from(outputs.superblockNumber).ok()?,
        root_claim: call._rootClaim,
        // The batch hash the next superblock references as its parent.
        hash: keccak256(outputs.abi_encode()),
        parent_hash: outputs.parentSuperblockBatchHash,
        game_address,
        chains,
        transitions,
    })
}

struct SettlementDecoder {
    chain_id: i32,
    factory: Address,
    game_type: u32,
    chain_filter: RollupChainFilter,
}

#[derive(Clone, Debug, Default)]
struct RollupChainFilter {
    chain_ids: Box<[i32]>,
}

impl RollupChainFilter {
    fn new(chain_ids: impl IntoIterator<Item = i32>) -> Self {
        let mut chain_ids = chain_ids.into_iter().collect::<Vec<_>>();
        chain_ids.sort_unstable();
        chain_ids.dedup();
        Self {
            chain_ids: chain_ids.into_boxed_slice(),
        }
    }

    fn matches(&self, chains: &[i32]) -> bool {
        self.chain_ids.is_empty()
            || chains
                .iter()
                .any(|chain| self.chain_ids.binary_search(chain).is_ok())
    }
}

#[async_trait]
impl LogDecoder for SettlementDecoder {
    fn filter(&self) -> Filter {
        Filter::new()
            .address(self.factory)
            .event_signature(IDisputeGameFactory::DisputeGameCreated::SIGNATURE_HASH)
    }

    async fn decode(&self, provider: &DynProvider, log: &Log) -> Vec<DomainEvent> {
        if topic0(log) != Some(IDisputeGameFactory::DisputeGameCreated::SIGNATURE_HASH) {
            return Vec::new();
        }
        let Ok(created) = IDisputeGameFactory::DisputeGameCreated::decode_log(&log.inner) else {
            return Vec::new();
        };
        if created.gameType != self.game_type {
            return Vec::new();
        }

        // The event only carries the claim; the superblock payload rides in
        // the `create()` calldata.
        let Some(tx_hash) = log.transaction_hash else {
            return Vec::new();
        };
        let tx = match provider.get_transaction_by_hash(tx_hash).await {
            Ok(Some(tx)) => tx,
            Ok(None) => {
                warn!(%tx_hash, "dispute game create tx not found");
                return Vec::new();
            }
            Err(e) => {
                warn!(%tx_hash, error = %e, "dispute game create tx fetch failed");
                return Vec::new();
            }
        };

        match decode_create_calldata(tx.input(), self.game_type, created.disputeProxy) {
            Some(kind) if self.accepts(&kind) => {
                vec![DomainEvent::new(
                    meta_with_receipt(provider, self.chain_id, log, true).await,
                    kind,
                )]
            }
            Some(_) => {
                debug!(%tx_hash, "superblock is outside configured rollup chain set; skipping");
                Vec::new()
            }
            None => {
                warn!(%tx_hash, "undecodable dispute game extraData; skipping");
                Vec::new()
            }
        }
    }
}

impl SettlementDecoder {
    fn accepts(&self, kind: &EventKind) -> bool {
        match kind {
            EventKind::SuperblockProposed { chains, .. } => self.chain_filter.matches(chains),
            _ => true,
        }
    }
}

/// Polls the L1 dispute game factory for compose-type game creations.
pub struct SettlementSource {
    cfg: PollConfig,
    decoder: SettlementDecoder,
}

/// Configuration for L1 dispute-game settlement ingestion.
#[derive(Clone, Debug)]
pub struct SettlementSourceConfig {
    pub l1_chain_id: i32,
    pub l1_rpc_url: String,
    pub factory: Address,
    pub game_type: u32,
    /// Rollup chain IDs this indexer is responsible for. Empty means accept
    /// every compose superblock from the factory.
    pub allowed_chains: Vec<i32>,
    pub start_block: Option<u64>,
    pub poll_ms: u64,
    pub max_range: u64,
}

impl SettlementSource {
    pub fn new(cfg: SettlementSourceConfig) -> Self {
        let chain_filter = RollupChainFilter::new(cfg.allowed_chains);
        Self {
            cfg: PollConfig {
                name: "ingest-settlement",
                rpc_url: cfg.l1_rpc_url,
                chain_id: cfg.l1_chain_id,
                start_block: cfg.start_block,
                poll_ms: cfg.poll_ms,
                track_heads: false,
                max_range: cfg.max_range,
            },
            decoder: SettlementDecoder {
                chain_id: cfg.l1_chain_id,
                factory: cfg.factory,
                game_type: cfg.game_type,
                chain_filter,
            },
        }
    }
}

#[async_trait]
impl Source for SettlementSource {
    fn name(&self) -> &'static str {
        "ingest-settlement"
    }

    async fn run(self: Box<Self>, sink: EventSink) -> Result<(), SourceError> {
        poll_logs(self.cfg, sink, self.decoder).await
    }
}

/// Polls the compose anchor state registry for finalized superblocks.
pub struct AnchorSource {
    l1_chain_id: i32,
    l1_rpc_url: String,
    registry: Address,
    poll_ms: u64,
}

impl AnchorSource {
    pub fn new(
        l1_chain_id: i32,
        l1_rpc_url: impl Into<String>,
        registry: Address,
        poll_ms: u64,
    ) -> Self {
        Self {
            l1_chain_id,
            l1_rpc_url: l1_rpc_url.into(),
            registry,
            poll_ms,
        }
    }
}

#[async_trait]
impl Source for AnchorSource {
    fn name(&self) -> &'static str {
        "ingest-anchor"
    }

    async fn run(self: Box<Self>, sink: EventSink) -> Result<(), SourceError> {
        let provider = ProviderBuilder::new()
            .connect_http(self.l1_rpc_url.parse()?)
            .erased();
        let registry = IComposeAnchorStateRegistry::new(self.registry, provider.clone());
        let mut last_anchored: Option<i64> = None;
        debug!(registry = %self.registry, "starting anchor poller");

        loop {
            match registry.getAnchorRoot().call().await {
                Ok(anchor) => {
                    let number = i64::try_from(anchor.l2SequenceNumber_).unwrap_or_default();
                    let advanced = last_anchored.is_none_or(|l| number > l);
                    if anchor.root_ != B256::ZERO && advanced {
                        let l1_block = provider.get_block_number().await.unwrap_or_default();
                        let ev = DomainEvent::new(
                            EventMeta {
                                chain_id: self.l1_chain_id,
                                block_number: l1_block as i64,
                                // The view result has no log coordinates; a
                                // per-number synthetic hash keeps the
                                // idempotency key stable across restarts.
                                block_hash: anchor_event_hash(number),
                                log_index: 0,
                                tx_hash: None,
                                gas_used: None,
                                effective_gas_price_wei: None,
                                timestamp: chrono::Utc::now(),
                                safe: true,
                            },
                            EventKind::SuperblockFinalized {
                                number,
                                anchor_root: anchor.root_,
                            },
                        );
                        sink.send(ev).await.map_err(|_| SinkClosed)?;
                        last_anchored = Some(number);
                    }
                }
                Err(e) => warn!(error = %e, "getAnchorRoot failed; retrying"),
            }
            tokio::time::sleep(Duration::from_millis(self.poll_ms)).await;
        }
    }
}

fn anchor_event_hash(number: i64) -> B256 {
    let mut buf = *b"compose-anchor:0000000000000000";
    buf[15..23].copy_from_slice(&number.to_be_bytes());
    keccak256(buf)
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy::primitives::U256;

    fn proposed_with_chains(chains: Vec<i32>) -> EventKind {
        EventKind::SuperblockProposed {
            number: 1,
            root_claim: B256::ZERO,
            hash: B256::ZERO,
            parent_hash: B256::ZERO,
            game_address: Address::ZERO,
            chains,
            transitions: Vec::new(),
        }
    }

    #[test]
    fn decodes_create_calldata_into_superblock() {
        let outputs = SuperblockAggregationOutputs {
            superblockNumber: U256::from(7u64),
            parentSuperblockBatchHash: B256::repeat_byte(0x01),
            bootInfo: vec![BootInfoStruct {
                l1Head: B256::repeat_byte(0x02),
                l2PreRoot: B256::repeat_byte(0x03),
                l2PostRoot: B256::repeat_byte(0x04),
                l2BlockNumber: 1234,
                rollupConfigHash: B256::repeat_byte(0x05),
            }],
        };
        let proof = SuperRootProof {
            version: [0x01].into(),
            timestamp: 42,
            outputRoots: vec![OutputRootWithChainId {
                chainId: U256::from(4100u64),
                root: B256::repeat_byte(0x04),
            }],
        };
        let extra: Bytes = (outputs.clone(), proof, Bytes::from_static(b"MOCK"))
            .abi_encode_params()
            .into();
        let call = IDisputeGameFactory::createCall {
            _gameType: 5555,
            _rootClaim: B256::repeat_byte(0xaa),
            _extraData: extra,
        };

        let game = Address::repeat_byte(0x77);
        let kind = decode_create_calldata(&call.abi_encode(), 5555, game).expect("decodes");
        let EventKind::SuperblockProposed {
            number,
            root_claim,
            hash,
            parent_hash,
            game_address,
            chains,
            transitions,
        } = kind
        else {
            panic!("wrong kind");
        };
        assert_eq!(number, 7);
        assert_eq!(root_claim, B256::repeat_byte(0xaa));
        assert_eq!(hash, keccak256(outputs.abi_encode()));
        assert_eq!(parent_hash, B256::repeat_byte(0x01));
        assert_eq!(game_address, game);
        assert_eq!(chains, vec![4100]);
        assert_eq!(transitions.len(), 1);
        assert_eq!(transitions[0].l2_block, 1234);
    }

    #[test]
    fn foreign_game_type_is_skipped() {
        let call = IDisputeGameFactory::createCall {
            _gameType: 1,
            _rootClaim: B256::ZERO,
            _extraData: Bytes::new(),
        };
        assert!(decode_create_calldata(&call.abi_encode(), 5555, Address::ZERO).is_none());
    }

    #[test]
    fn empty_rollup_chain_filter_accepts_any_superblock() {
        let filter = RollupChainFilter::default();

        assert!(filter.matches(&[5100, 5200]));
        assert!(filter.matches(&[4100, 4200]));
    }

    #[test]
    fn rollup_chain_filter_accepts_any_overlap() {
        let filter = RollupChainFilter::new([4100, 4200]);

        assert!(filter.matches(&[5100, 4200]));
        assert!(filter.matches(&[4100]));
    }

    #[test]
    fn rollup_chain_filter_rejects_foreign_superblocks() {
        let filter = RollupChainFilter::new([4100, 4200]);

        assert!(!filter.matches(&[5100, 5200]));
    }

    #[test]
    fn settlement_decoder_rejects_foreign_superblock_events() {
        let decoder = SettlementDecoder {
            chain_id: 900,
            factory: Address::ZERO,
            game_type: 5555,
            chain_filter: RollupChainFilter::new([4200, 4100, 4100]),
        };

        assert!(decoder.accepts(&proposed_with_chains(vec![4100, 5100])));
        assert!(!decoder.accepts(&proposed_with_chains(vec![5100, 5200])));
    }

    #[test]
    fn anchor_event_hash_is_stable_and_distinct() {
        assert_eq!(anchor_event_hash(1), anchor_event_hash(1));
        assert_ne!(anchor_event_hash(1), anchor_event_hash(2));
    }
}
