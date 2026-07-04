//! Execution-layer ingestion: decodes one rollup's `UniversalBridgeMailbox`
//! and `ComposeL2ToL2Bridge` logs into normalized [`DomainEvent`]s. One
//! `ElSource` runs per participating rollup (host + counterparties), so both
//! legs of a cross-chain session are observed.
//!
//! The mailbox only logs `New{Outbox,Inbox}Key(index, key)`; the message
//! header (chains, sender, receiver, session, label) is read back through the
//! contract's append-only `messageHeaderList{Outbox,Inbox}(index)` views.

pub mod evm;

use alloy::primitives::{Address, B256, U256};
use alloy::providers::DynProvider;
use alloy::rpc::types::{Filter, Log};
use alloy::sol;
use alloy::sol_types::SolEvent;
use async_trait::async_trait;
use cross_scout_types::{DomainEvent, EventKind, EventSink, Source, SourceError};
use evm::{meta_of, poll_logs, topic0, LogDecoder, PollConfig};
use tracing::warn;

sol! {
    #[sol(rpc)]
    interface IUniversalBridgeMailbox {
        event NewOutboxKey(uint256 indexed index, bytes32 key);
        event NewInboxKey(uint256 indexed index, bytes32 key);

        function messageHeaderListOutbox(uint256 index) external view returns (
            uint256 chainSrc, uint256 chainDest, address sender, address receiver,
            uint256 sessionId, string memory label);
        function messageHeaderListInbox(uint256 index) external view returns (
            uint256 chainSrc, uint256 chainDest, address sender, address receiver,
            uint256 sessionId, string memory label);
    }

    interface IComposeL2ToL2Bridge {
        event ETHBridged(uint256 indexed chainDest, address indexed sender,
            address indexed receiver, uint256 amount, uint256 sessionId, bytes32 messageId);
        event TokensSendQueued(uint256 indexed chainDest, address indexed sender,
            address indexed receiver, address remoteAsset, uint256 amount,
            uint256 sessionId, bytes32 messageId);
    }
}

/// Narrow a `uint256` chain id to the `i32` the store carries.
pub fn chain_i32(v: U256) -> i32 {
    i32::try_from(v).unwrap_or_default()
}

/// Widen a mailbox `uint256 sessionId` to the bytes32 XT identity.
pub fn session_b256(session_id: U256) -> B256 {
    B256::from(session_id)
}

/// A decoded mailbox message header.
struct Header {
    session: B256,
    src_chain: i32,
    dst_chain: i32,
    sender: Address,
    receiver: Address,
    label: String,
}

impl Header {
    fn new(
        session_id: U256,
        chain_src: U256,
        chain_dest: U256,
        sender: Address,
        receiver: Address,
        label: String,
    ) -> Self {
        Self {
            session: session_b256(session_id),
            src_chain: chain_i32(chain_src),
            dst_chain: chain_i32(chain_dest),
            sender,
            receiver,
            label,
        }
    }
}

struct ElDecoder {
    chain_id: i32,
    mailbox: Address,
    bridges: Vec<Address>,
}

impl ElDecoder {
    /// Read the message header behind a `New{Outbox,Inbox}Key` log. The
    /// header lists are append-only, so reading at the latest block is safe
    /// and keeps the source usable against non-archive nodes.
    async fn fetch_header(
        &self,
        provider: &DynProvider,
        index: U256,
        outbox: bool,
    ) -> Option<Header> {
        let mailbox = IUniversalBridgeMailbox::new(self.mailbox, provider.clone());
        let header = if outbox {
            mailbox
                .messageHeaderListOutbox(index)
                .call()
                .await
                .map(|h| {
                    Header::new(
                        h.sessionId,
                        h.chainSrc,
                        h.chainDest,
                        h.sender,
                        h.receiver,
                        h.label,
                    )
                })
        } else {
            mailbox.messageHeaderListInbox(index).call().await.map(|h| {
                Header::new(
                    h.sessionId,
                    h.chainSrc,
                    h.chainDest,
                    h.sender,
                    h.receiver,
                    h.label,
                )
            })
        };
        match header {
            Ok(h) => Some(h),
            Err(e) => {
                let side = if outbox { "outbox" } else { "inbox" };
                warn!(chain_id = self.chain_id, %index, side, error = %e, "mailbox header lookup failed");
                None
            }
        }
    }
}

#[async_trait]
impl LogDecoder for ElDecoder {
    fn filter(&self) -> Filter {
        let mut addresses = Vec::with_capacity(1 + self.bridges.len());
        addresses.push(self.mailbox);
        addresses.extend_from_slice(&self.bridges);
        Filter::new().address(addresses)
    }

    async fn decode(&self, provider: &DynProvider, log: &Log) -> Vec<DomainEvent> {
        let Some(t0) = topic0(log) else {
            return Vec::new();
        };

        let kind = if t0 == IUniversalBridgeMailbox::NewOutboxKey::SIGNATURE_HASH {
            let Ok(e) = IUniversalBridgeMailbox::NewOutboxKey::decode_log(&log.inner) else {
                return Vec::new();
            };
            let Some(h) = self.fetch_header(provider, e.index, true).await else {
                return Vec::new();
            };
            EventKind::MessageDispatched {
                key: e.key,
                session: h.session,
                src_chain: h.src_chain,
                dst_chain: h.dst_chain,
                sender: h.sender,
                receiver: h.receiver,
                label: h.label,
            }
        } else if t0 == IUniversalBridgeMailbox::NewInboxKey::SIGNATURE_HASH {
            let Ok(e) = IUniversalBridgeMailbox::NewInboxKey::decode_log(&log.inner) else {
                return Vec::new();
            };
            let Some(h) = self.fetch_header(provider, e.index, false).await else {
                return Vec::new();
            };
            EventKind::MessageDelivered {
                key: e.key,
                session: h.session,
                src_chain: h.src_chain,
                dst_chain: h.dst_chain,
                sender: h.sender,
                receiver: h.receiver,
                label: h.label,
            }
        } else if let Some(kind) = decode_bridge_log(self.chain_id, log) {
            kind
        } else {
            return Vec::new();
        };

        vec![DomainEvent::new(meta_of(self.chain_id, log, true), kind)]
    }
}

/// Decode a `ComposeL2ToL2Bridge` source-leg log into an [`EventKind`],
/// carrying the full transfer detail (receiver, asset, amount, message id).
/// `asset = None` marks native ETH; `Some` an ERC-20 (amount in base units).
/// Returns `None` for any non-bridge log.
pub fn decode_bridge_log(chain_id: i32, log: &Log) -> Option<EventKind> {
    let t0 = topic0(log)?;
    if t0 == IComposeL2ToL2Bridge::ETHBridged::SIGNATURE_HASH {
        let e = IComposeL2ToL2Bridge::ETHBridged::decode_log(&log.inner).ok()?;
        Some(EventKind::XtRequested {
            session: session_b256(e.sessionId),
            src_chain: chain_id,
            dst_chain: chain_i32(e.chainDest),
            sender: e.sender,
            receiver: e.receiver,
            asset: None,
            amount: e.amount,
            message_id: Some(e.messageId),
        })
    } else if t0 == IComposeL2ToL2Bridge::TokensSendQueued::SIGNATURE_HASH {
        let e = IComposeL2ToL2Bridge::TokensSendQueued::decode_log(&log.inner).ok()?;
        Some(EventKind::XtRequested {
            session: session_b256(e.sessionId),
            src_chain: chain_id,
            dst_chain: chain_i32(e.chainDest),
            sender: e.sender,
            receiver: e.receiver,
            asset: Some(e.remoteAsset),
            amount: e.amount,
            message_id: Some(e.messageId),
        })
    } else {
        None
    }
}

/// Polls one rollup's mailbox + bridge contracts for cross-chain logs.
pub struct ElSource {
    cfg: PollConfig,
    decoder: ElDecoder,
}

impl ElSource {
    pub fn new(
        chain_id: i32,
        rpc_url: impl Into<String>,
        mailbox: Address,
        bridges: Vec<Address>,
        start_block: Option<u64>,
        poll_ms: u64,
        max_range: u64,
    ) -> Self {
        Self {
            cfg: PollConfig {
                name: "ingest-el",
                rpc_url: rpc_url.into(),
                chain_id,
                start_block,
                poll_ms,
                track_heads: true,
                max_range,
            },
            decoder: ElDecoder {
                chain_id,
                mailbox,
                bridges,
            },
        }
    }
}

#[async_trait]
impl Source for ElSource {
    fn name(&self) -> &'static str {
        "ingest-el"
    }

    async fn run(self: Box<Self>, sink: EventSink) -> Result<(), SourceError> {
        poll_logs(self.cfg, sink, self.decoder).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn log_of<E: SolEvent>(event: &E) -> Log {
        Log {
            inner: alloy::primitives::Log {
                address: Address::ZERO,
                data: event.encode_log_data(),
            },
            ..Default::default()
        }
    }

    #[test]
    fn decodes_eth_bridged_into_native_transfer() {
        let ev = IComposeL2ToL2Bridge::ETHBridged {
            chainDest: U256::from(4200u64),
            sender: Address::repeat_byte(0x11),
            receiver: Address::repeat_byte(0x22),
            amount: U256::from(1_000u64),
            sessionId: U256::from(7u64),
            messageId: B256::repeat_byte(0x33),
        };

        let kind = decode_bridge_log(4100, &log_of(&ev)).expect("decodes");
        let EventKind::XtRequested {
            session,
            src_chain,
            dst_chain,
            sender,
            receiver,
            asset,
            amount,
            message_id,
        } = kind
        else {
            panic!("wrong kind");
        };
        assert_eq!(session, B256::from(U256::from(7u64)));
        assert_eq!(src_chain, 4100);
        assert_eq!(dst_chain, 4200);
        assert_eq!(sender, Address::repeat_byte(0x11));
        assert_eq!(receiver, Address::repeat_byte(0x22));
        assert_eq!(asset, None);
        assert_eq!(amount, U256::from(1_000u64));
        assert_eq!(message_id, Some(B256::repeat_byte(0x33)));
    }

    #[test]
    fn decodes_tokens_send_queued_into_erc20_transfer() {
        let ev = IComposeL2ToL2Bridge::TokensSendQueued {
            chainDest: U256::from(4200u64),
            sender: Address::repeat_byte(0xaa),
            receiver: Address::repeat_byte(0xbb),
            remoteAsset: Address::repeat_byte(0xcc),
            amount: U256::from(500u64),
            sessionId: U256::from(9u64),
            messageId: B256::repeat_byte(0xdd),
        };

        let kind = decode_bridge_log(4100, &log_of(&ev)).expect("decodes");
        let EventKind::XtRequested {
            asset,
            amount,
            receiver,
            message_id,
            ..
        } = kind
        else {
            panic!("wrong kind");
        };
        // The token address rides in `asset`; the amount is base units, never
        // conflated with native wei.
        assert_eq!(asset, Some(Address::repeat_byte(0xcc)));
        assert_eq!(amount, U256::from(500u64));
        assert_eq!(receiver, Address::repeat_byte(0xbb));
        assert_eq!(message_id, Some(B256::repeat_byte(0xdd)));
    }

    #[test]
    fn ignores_non_bridge_logs() {
        let ev = IUniversalBridgeMailbox::NewOutboxKey {
            index: U256::from(1u64),
            key: B256::ZERO,
        };
        assert!(decode_bridge_log(4100, &log_of(&ev)).is_none());
    }
}
