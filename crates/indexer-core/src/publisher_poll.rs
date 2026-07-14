//! Publisher (coordinator) stats poller.
//!
//! When a `PUBLISHER_URL` is configured, this task samples the publisher's
//! `/stats` endpoint on the shared poll cadence and records two things: the
//! observed SBCP period (so the explorer can show period → superblock
//! progression without an on-chain signal) and a bounded liveness time series
//! of coordinator counters. It writes Postgres directly - these are telemetry,
//! not chain events, so they carry no provenance and never flow through the
//! correlation engine. The `/stats` JSON is read field-by-field and defaulted,
//! so a schema drift on the publisher degrades to zeros rather than a crash.

use std::time::{Duration, Instant};

use cross_scout_store::Db;
use serde_json::Value;
use tracing::{debug, warn};

/// Snapshots older than this are pruned.
const RETENTION_SECS: i64 = 7 * 24 * 60 * 60;
/// Minimum spacing between prune passes; polling is much more frequent.
const PRUNE_INTERVAL: Duration = Duration::from_secs(600);

/// Read an integer field, defaulting to 0 when absent or the wrong type.
fn int_field(v: &Value, key: &str) -> i64 {
    v.get(key).and_then(Value::as_i64).unwrap_or(0)
}

/// Run the poll loop until the process ends.
pub async fn run(db: Db, base_url: String, poll_ms: u64) {
    let client = reqwest::Client::new();
    let url = format!("{}/stats", base_url.trim_end_matches('/'));
    let mut ticker = tokio::time::interval(Duration::from_millis(poll_ms));
    let mut last_prune: Option<Instant> = None;
    let mut last_period_conflict: Option<(i64, i64)> = None;
    debug!(%url, "starting publisher stats poller");

    loop {
        ticker.tick().await;
        let stats = match fetch(&client, &url).await {
            Ok(s) => s,
            Err(e) => {
                warn!(error = %e, "publisher stats fetch failed; retrying");
                continue;
            }
        };
        match record(&db, &stats).await {
            Ok(true) => last_period_conflict = None,
            Ok(false) => {
                let conflict = (
                    int_field(&stats, "current_period_id"),
                    int_field(&stats, "next_superblock_number"),
                );
                if last_period_conflict != Some(conflict) {
                    warn!(
                        period_id = conflict.0,
                        next_superblock = conflict.1,
                        "ignoring conflicting publisher period mapping"
                    );
                    last_period_conflict = Some(conflict);
                }
            }
            Err(e) => {
                warn!(error = %e, "publisher stats write failed");
                continue;
            }
        }
        if last_prune.is_none_or(|at| at.elapsed() >= PRUNE_INTERVAL) {
            if let Err(e) = db.prune_snapshots(RETENTION_SECS).await {
                warn!(error = %e, "publisher snapshot prune failed");
            } else {
                last_prune = Some(Instant::now());
            }
        }
    }
}

async fn fetch(client: &reqwest::Client, url: &str) -> reqwest::Result<Value> {
    client
        .get(url)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await
}

async fn record(db: &Db, stats: &Value) -> cross_scout_store::StoreResult<bool> {
    let now = chrono::Utc::now();
    let period_id = int_field(stats, "current_period_id");
    let next_superblock = int_field(stats, "next_superblock_number");
    let last_finalized = int_field(stats, "last_finalized_superblock");

    // The current period will produce the next superblock; record that mapping.
    let period_is_canonical = db
        .upsert_period(period_id, Some(next_superblock), now)
        .await?;

    db.insert_publisher_snapshot(
        now,
        period_id,
        next_superblock,
        last_finalized,
        int_field(stats, "queued_xts") as i32,
        int_field(stats, "active_2pc_transactions") as i32,
        int_field(stats, "active_chains") as i32,
        int_field(stats, "active_connections") as i32,
        int_field(stats, "registered_chains") as i32,
        int_field(stats, "pending_proof_superblocks") as i32,
    )
    .await?;
    Ok(period_is_canonical)
}
