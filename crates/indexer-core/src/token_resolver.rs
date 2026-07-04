//! Background token-metadata resolver.
//!
//! Transfers reference tokens by address only; a stub row is written the first
//! time one appears. This task periodically drains those unresolved rows and
//! fills `symbol`/`name`/`decimals` via ERC-20 static calls against the RPC of
//! the chain the token lives on. A token whose calls fail (non-standard or not
//! yet deployed at the observed height) is left unresolved and retried on the
//! next sweep. Providers are built once per chain and reused.

use std::collections::HashMap;
use std::time::Duration;

use alloy::primitives::Address;
use alloy::providers::{DynProvider, Provider, ProviderBuilder};
use alloy::sol;
use cross_scout_store::Db;
use tracing::{debug, warn};

use crate::config::Config;

sol! {
    #[sol(rpc)]
    interface IERC20Metadata {
        function symbol() external view returns (string);
        function name() external view returns (string);
        function decimals() external view returns (uint8);
    }
}

/// How often to sweep the unresolved-token backlog.
const SWEEP_INTERVAL: Duration = Duration::from_secs(30);
/// Tokens resolved per sweep - bounds RPC load on a large backlog.
const BATCH: i64 = 32;

/// Resolve one token's metadata. Missing individual fields are tolerated (a
/// token may implement only some of the interface); a hard RPC/connection
/// failure returns `None` so the row is retried next sweep.
async fn resolve_one(
    provider: &DynProvider,
    address: Address,
) -> Option<(Option<String>, Option<String>, Option<i32>)> {
    let token = IERC20Metadata::new(address, provider.clone());
    let symbol_call = token.symbol();
    let name_call = token.name();
    let decimals_call = token.decimals();
    let (symbol, name, decimals) =
        tokio::join!(symbol_call.call(), name_call.call(), decimals_call.call());
    let symbol = symbol.ok();
    let name = name.ok();
    let decimals = decimals.ok().map(i32::from);

    // Nothing came back at all - treat as a transient miss, not a resolution.
    if symbol.is_none() && name.is_none() && decimals.is_none() {
        return None;
    }
    Some((symbol, name, decimals))
}

/// Run the resolver loop until the process ends. Chains without a configured
/// RPC are skipped (their tokens stay unresolved rather than blocking others).
pub async fn run(db: Db, cfg: Config) {
    let providers = build_providers(&cfg);
    if providers.is_empty() {
        debug!("no EL RPCs configured; token resolver idle");
        return;
    }

    let mut ticker = tokio::time::interval(SWEEP_INTERVAL);
    loop {
        ticker.tick().await;
        let pending = match db.unresolved_tokens(BATCH).await {
            Ok(p) => p,
            Err(e) => {
                warn!(error = %e, "token resolver: unresolved_tokens query failed");
                continue;
            }
        };
        for (chain_id, address) in pending {
            let Some(provider) = providers.get(&chain_id) else {
                debug!(chain_id, "token resolver: no RPC for chain; skipping");
                continue;
            };
            match resolve_one(provider, address).await {
                Some((symbol, name, decimals)) => {
                    if let Err(e) = db
                        .resolve_token(
                            chain_id,
                            &address,
                            symbol.as_deref(),
                            name.as_deref(),
                            decimals,
                        )
                        .await
                    {
                        warn!(chain_id, %address, error = %e, "token resolver: resolve_token write failed");
                    }
                }
                None => {
                    warn!(chain_id, %address, "token resolver: metadata calls failed; retrying next sweep");
                }
            }
        }
    }
}

/// One erased provider per configured EL chain, built once and reused.
fn build_providers(cfg: &Config) -> HashMap<i32, DynProvider> {
    let mut providers = HashMap::new();
    for ep in &cfg.el_rpc_urls {
        match ep.url.parse() {
            Ok(url) => {
                providers.insert(
                    ep.chain_id,
                    ProviderBuilder::new().connect_http(url).erased(),
                );
            }
            Err(e) => warn!(chain_id = ep.chain_id, error = %e, "token resolver: bad RPC url"),
        }
    }
    providers
}
