//! Regenerate the TypeScript bindings from the Rust domain types.
//!
//! Run via `bun run gen:types` (which invokes
//! `cargo run -p cross-scout-types --features export --bin export-bindings`).
//! Exports every DTO plus its dependencies into the SDK's generated dir. The
//! committed `packages/sdk/src/types.ts` is hand-maintained; diff the generated
//! output against it when the Rust types change.
//!
//! Only compiled under the `export` feature so a plain `cargo build` never
//! pulls in the ts-rs export surface.

use cross_scout_types::{
    ActivityPoint, AssetVolume, Instance, MailboxMessage, NetworkStats, PeriodInfo,
    PublisherSnapshot, Stage, StreamEvent, Superblock, TokenMeta, Transfer, TxFee, Xt, XtDetail,
    XtPage,
};
use ts_rs::TS;

const OUT_DIR: &str = "packages/sdk/src/generated";

fn main() -> Result<(), ts_rs::ExportError> {
    // `export_all_to` walks each type's dependency graph, so exporting the
    // aggregate roots covers every nested struct and enum.
    Xt::export_all_to(OUT_DIR)?;
    XtDetail::export_all_to(OUT_DIR)?;
    XtPage::export_all_to(OUT_DIR)?;
    Instance::export_all_to(OUT_DIR)?;
    MailboxMessage::export_all_to(OUT_DIR)?;
    Superblock::export_all_to(OUT_DIR)?;
    TxFee::export_all_to(OUT_DIR)?;
    NetworkStats::export_all_to(OUT_DIR)?;
    StreamEvent::export_all_to(OUT_DIR)?;
    Stage::export_all_to(OUT_DIR)?;
    Transfer::export_all_to(OUT_DIR)?;
    TokenMeta::export_all_to(OUT_DIR)?;
    ActivityPoint::export_all_to(OUT_DIR)?;
    AssetVolume::export_all_to(OUT_DIR)?;
    PublisherSnapshot::export_all_to(OUT_DIR)?;
    PeriodInfo::export_all_to(OUT_DIR)?;

    println!("exported TypeScript bindings to {OUT_DIR}");
    Ok(())
}
