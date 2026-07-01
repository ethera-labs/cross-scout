//! Flashblock ingestion: subscribes to the op-rbuilder websocket and surfaces
//! in-flight XTs from ~200ms pre-confirmation sub-blocks. Pre-confs are emitted
//! `unsafe` - they can be reorged before the sealing block confirms - and when
//! a flashblock seals a safe `BlockSealed` is emitted alongside.

use std::time::Duration;

use alloy::primitives::B256;
use async_trait::async_trait;
use cross_scout_types::{
    DomainEvent, EventKind, EventMeta, EventSink, SinkClosed, Source, SourceError,
};
use futures::StreamExt;
use serde::Deserialize;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;
use tracing::{debug, warn};

/// One op-rbuilder flashblock frame. Only the fields the indexer depends on are
/// modeled: the chain, the sub-block index, the sealed flag and the XT hashes
/// the frame carries.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FlashblockMsg {
    chain_id: i32,
    #[serde(default)]
    index: i32,
    #[serde(default)]
    sealed: bool,
    #[serde(default)]
    block_number: i64,
    #[serde(default)]
    block_hash: B256,
    #[serde(default)]
    state_root: B256,
    #[serde(default)]
    xt_hashes: Vec<B256>,
}

fn frame_to_events(fb: FlashblockMsg) -> Vec<DomainEvent> {
    let now = chrono::Utc::now();
    let mut out = Vec::with_capacity(fb.xt_hashes.len() + usize::from(fb.sealed));

    // `log_index` combines the sub-block index and the XT position so the
    // idempotency key stays unique across sub-blocks that share a hash.
    for (i, xt) in fb.xt_hashes.iter().enumerate() {
        out.push(DomainEvent::new(
            EventMeta {
                chain_id: fb.chain_id,
                block_number: fb.block_number,
                block_hash: fb.block_hash,
                log_index: fb.index * 1000 + i as i32,
                tx_hash: None,
                timestamp: now,
                safe: false,
            },
            EventKind::Flashblock {
                chain_id: fb.chain_id,
                xt_hash: *xt,
                index: fb.index,
            },
        ));
    }

    if fb.sealed {
        out.push(DomainEvent::new(
            EventMeta {
                chain_id: fb.chain_id,
                block_number: fb.block_number,
                block_hash: fb.block_hash,
                // The seal; log_index -1 keeps its key distinct from pre-confs.
                log_index: -1,
                tx_hash: None,
                timestamp: now,
                safe: true,
            },
            EventKind::BlockSealed {
                chain_id: fb.chain_id,
                number: fb.block_number,
                hash: fb.block_hash,
                state_root: fb.state_root,
            },
        ));
    }

    out
}

/// Streams pre-confirmations from an op-rbuilder websocket.
pub struct FlashblocksSource {
    ws_url: String,
    chain_id: i32,
}

impl FlashblocksSource {
    pub fn new(ws_url: impl Into<String>, chain_id: i32) -> Self {
        Self {
            ws_url: ws_url.into(),
            chain_id,
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
                        let text: String = match msg {
                            Ok(Message::Text(t)) => t.to_string(),
                            Ok(Message::Binary(b)) => String::from_utf8_lossy(&b).into_owned(),
                            Ok(Message::Close(_)) | Err(_) => break,
                            Ok(_) => continue,
                        };
                        match serde_json::from_str::<FlashblockMsg>(&text) {
                            Ok(fb) => {
                                for ev in frame_to_events(fb) {
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
