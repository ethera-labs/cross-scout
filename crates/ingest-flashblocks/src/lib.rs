//! Flashblock ingestion: subscribes to the op-rbuilder websocket and surfaces
//! in-flight XTs from ~200ms pre-confirmation sub-blocks.
//!
//! Frames are JSON `OpFlashblockPayload`s (`{payload_id, index, base?, diff,
//! metadata}`); only the fields the indexer depends on are mirrored here. Each
//! frame's `diff.transactions` carries the raw txs added by that flashblock -
//! any tx targeting the compose bridge is decoded into an `XtRequested`
//! pre-confirmation (`safe = false`, reorged away if its block never seals).

use std::time::Duration;

use alloy::consensus::transaction::SignerRecoverable;
use alloy::consensus::{Transaction, TxEnvelope};
use alloy::eips::eip2718::Decodable2718;
use alloy::primitives::{Address, Bytes, B256, U256};
use alloy::sol;
use alloy::sol_types::SolCall;
use async_trait::async_trait;
use cross_scout_types::{
    DomainEvent, EventKind, EventMeta, EventSink, SinkClosed, Source, SourceError,
};
use futures::StreamExt;
use serde::Deserialize;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;
use tracing::{debug, warn};

sol! {
    interface IComposeL2ToL2Bridge {
        function bridgeEthTo(uint256 sessionId, uint256 chainDest, address receiver) external payable;
        function bridgeERC20To(uint256 chainDest, address tokenSrc, uint256 amount,
            address receiver, uint256 sessionId) external;
        function bridgeCETTo(uint256 chainDest, address cetTokenSrc, uint256 amount,
            address receiver, uint256 sessionId) external;
    }
}

/// One op-rbuilder flashblock frame, mirroring `OpFlashblockPayload`. Unknown
/// fields are ignored so wire additions stay non-breaking.
#[derive(Debug, Deserialize)]
struct FlashblockFrame {
    index: u64,
    diff: FrameDiff,
    metadata: FrameMetadata,
}

#[derive(Debug, Deserialize)]
struct FrameDiff {
    block_hash: B256,
    transactions: Vec<Bytes>,
}

#[derive(Debug, Deserialize)]
struct FrameMetadata {
    block_number: u64,
}

/// A bridge call decoded out of a raw transaction.
struct BridgeCall {
    session_id: U256,
    dst_chain: U256,
    value: U256,
}

fn decode_bridge_call(input: &[u8], tx_value: U256) -> Option<BridgeCall> {
    let selector: [u8; 4] = input.get(..4)?.try_into().ok()?;
    match selector {
        IComposeL2ToL2Bridge::bridgeEthToCall::SELECTOR => {
            let c = IComposeL2ToL2Bridge::bridgeEthToCall::abi_decode(input).ok()?;
            Some(BridgeCall {
                session_id: c.sessionId,
                dst_chain: c.chainDest,
                value: tx_value,
            })
        }
        IComposeL2ToL2Bridge::bridgeERC20ToCall::SELECTOR => {
            let c = IComposeL2ToL2Bridge::bridgeERC20ToCall::abi_decode(input).ok()?;
            Some(BridgeCall {
                session_id: c.sessionId,
                dst_chain: c.chainDest,
                value: c.amount,
            })
        }
        IComposeL2ToL2Bridge::bridgeCETToCall::SELECTOR => {
            let c = IComposeL2ToL2Bridge::bridgeCETToCall::abi_decode(input).ok()?;
            Some(BridgeCall {
                session_id: c.sessionId,
                dst_chain: c.chainDest,
                value: c.amount,
            })
        }
        _ => None,
    }
}

/// Extract pre-confirmed bridge calls from one frame. Deposit txs (type 0x7E)
/// fail the envelope decode and are skipped - user bridge calls are always
/// plain signed txs.
fn frame_to_events(chain_id: i32, bridges: &[Address], fb: &FlashblockFrame) -> Vec<DomainEvent> {
    let now = chrono::Utc::now();
    let mut out = Vec::new();

    for (i, raw) in fb.diff.transactions.iter().enumerate() {
        let Ok(env) = TxEnvelope::decode_2718(&mut raw.as_ref()) else {
            continue;
        };
        let Some(to) = env.to() else { continue };
        if !bridges.contains(&to) {
            continue;
        }
        let Some(call) = decode_bridge_call(env.input(), env.value()) else {
            continue;
        };
        let sender = env.recover_signer().unwrap_or_default();

        out.push(DomainEvent::new(
            EventMeta {
                chain_id,
                block_number: fb.metadata.block_number as i64,
                block_hash: fb.diff.block_hash,
                // Combines the sub-block index and the tx position so the
                // idempotency key stays unique within the sealing block.
                log_index: (fb.index * 1000 + i as u64) as i32,
                tx_hash: Some(*env.tx_hash()),
                timestamp: now,
                safe: false,
            },
            EventKind::XtRequested {
                session: B256::from(call.session_id),
                src_chain: chain_id,
                dst_chain: cross_scout_ingest_el::chain_i32(call.dst_chain),
                sender,
                value_wei: call.value,
            },
        ));
    }

    out
}

/// Streams pre-confirmations from an op-rbuilder websocket.
pub struct FlashblocksSource {
    ws_url: String,
    chain_id: i32,
    bridges: Vec<Address>,
}

impl FlashblocksSource {
    pub fn new(ws_url: impl Into<String>, chain_id: i32, bridges: Vec<Address>) -> Self {
        Self {
            ws_url: ws_url.into(),
            chain_id,
            bridges,
        }
    }
}

#[async_trait]
impl Source for FlashblocksSource {
    fn name(&self) -> &'static str {
        "ingest-flashblocks"
    }

    async fn run(self: Box<Self>, sink: EventSink) -> Result<(), SourceError> {
        loop {
            match connect_async(self.ws_url.as_str()).await {
                Ok((ws, _)) => {
                    debug!(chain_id = self.chain_id, "flashblocks ws connected");
                    let (_, mut read) = ws.split();
                    while let Some(msg) = read.next().await {
                        let frame = match &msg {
                            Ok(Message::Text(t)) => serde_json::from_str::<FlashblockFrame>(t),
                            Ok(Message::Binary(b)) => serde_json::from_slice::<FlashblockFrame>(b),
                            Ok(Message::Close(_)) | Err(_) => break,
                            Ok(_) => continue,
                        };
                        match frame {
                            Ok(fb) => {
                                for ev in frame_to_events(self.chain_id, &self.bridges, &fb) {
                                    sink.send(ev).await.map_err(|_| SinkClosed)?;
                                }
                            }
                            Err(e) => debug!(error = %e, "unparseable flashblock frame"),
                        }
                    }
                    warn!("flashblocks ws closed; reconnecting");
                }
                Err(e) => warn!(error = %e, "flashblocks ws connect failed; retrying"),
            }
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy::sol_types::SolCall;

    #[test]
    fn decodes_eth_bridge_calldata() {
        let call = IComposeL2ToL2Bridge::bridgeEthToCall {
            sessionId: U256::from(42),
            chainDest: U256::from(4200),
            receiver: Address::repeat_byte(0x11),
        };
        let input = call.abi_encode();
        let decoded = decode_bridge_call(&input, U256::from(1_000_000u64)).expect("decodes");
        assert_eq!(decoded.session_id, U256::from(42));
        assert_eq!(decoded.dst_chain, U256::from(4200));
        assert_eq!(decoded.value, U256::from(1_000_000u64));
    }

    #[test]
    fn decodes_erc20_bridge_calldata_with_amount_as_value() {
        let call = IComposeL2ToL2Bridge::bridgeERC20ToCall {
            chainDest: U256::from(4100),
            tokenSrc: Address::repeat_byte(0x22),
            amount: U256::from(500u64),
            receiver: Address::repeat_byte(0x33),
            sessionId: U256::from(7),
        };
        let input = call.abi_encode();
        let decoded = decode_bridge_call(&input, U256::ZERO).expect("decodes");
        assert_eq!(decoded.session_id, U256::from(7));
        assert_eq!(decoded.value, U256::from(500u64));
    }

    #[test]
    fn unknown_selector_is_skipped() {
        assert!(decode_bridge_call(&[0xde, 0xad, 0xbe, 0xef, 0x00], U256::ZERO).is_none());
    }
}
