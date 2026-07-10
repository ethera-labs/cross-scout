# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

CrossScout is a **per-rollup cross-chain indexer** for the Ethera network. One instance runs
inside each rollup's infra (`HOST_CHAIN_ID`) and surfaces only the cross-chain transactions (XTs)
that host rollup participates in. The hard problem is **correlation, not ingestion**: a single XT
leaves signals across N sequencers and an L1 settlement contract, at different times on different
chains. The indexer stitches them into one lifecycle keyed by the mailbox **session id** and
serves the joined view over REST + WebSocket.

`README.md` has the full architecture diagram, endpoint table, and design notes - read it first.

## Commands

Everything reads `.env` (copy from `.env.example`; ready-made presets exist for the two live
environments: `.env.localnet` for the local-testnet stack, `.env.stage` for sepolia-stage). The
indexer and the api both need the env exported into the shell.

```bash
make up                     # start postgres (docker compose)
make dev                    # indexer + api + explorer together (also runs `up` + bun install)
make indexer / api / explorer   # run one process (each sources .env for you)

# Rust (workspace)
cargo test --workspace                                   # correlation/state-machine tests
cargo test -p cross-scout-correlate sealed_mailbox_write_includes_a_requested_xt   # a single test
cargo clippy --workspace --all-targets                   # lints (see gotcha below)
cargo fmt --all
make check                                               # cargo check --workspace --all-targets

# TypeScript (bun workspaces, turbo)
bun run typecheck           # turbo → all TS packages
bun run gen:types           # regenerate TS bindings from the Rust DTOs - see "Type sync" below
```

Requires Rust ≥ 1.89 (toolchain pinned `stable`) and Bun ≥ 1.3.

**Clippy gotcha:** the workspace sets `clippy::all = deny` and `unsafe_code = forbid`
(`Cargo.toml`). Any clippy warning fails the build; do not add `unsafe`. Follow the
`rust-best-practices` skill in `SKILL.md` for Rust style (borrow-over-clone, `thiserror` in
crates / `anyhow` only in the binary, no `unwrap`/`expect` outside tests, `#[expect(...)]` with a
reason over `#[allow(...)]`).

**Comments (all languages):** production comments only - explain what the code does and why in
domain terms. Never name environments, sibling components, or services, and never cite where code
or values were copied from; that context rots and leaks internals.

## Architecture

### The Rust pipeline (crates/)

Data flows **Source → DomainEvent → Correlator → Db (Postgres, rows + NOTIFY stream)**, all
wired by `indexer-core`:

- **`types`** - leaf crate every other depends on. Holds three distinct things, do not confuse
  the first two:
    - `event.rs` - `EventKind`/`DomainEvent`: the **internal** normalized events, keep native
      `alloy` primitives (`B256`, `Address`, `U256`). This is what ingesters emit and the engine
      consumes.
    - `dto.rs` - the **wire** types served by the api and exported to TypeScript. Hashes/addresses
      are `0x`-hex strings, timestamps RFC-3339, chain ids numbers.
    - `source.rs` - the `Source` trait (one long-running `run(sink)` task per ingester) + the
      bounded `EventSink` channel.
    - `lib.rs` - `Stage` (lifecycle 1..=9 + terminal `RolledBack=255`) and its `status()` mapping to
      `XtStatus`. `Stage` is the single source of truth, re-exported by `correlate`. Stages 2..=5
      are the publisher's off-chain 2PC phases with no public signal today - live ingestion jumps
      `Requested → Included`; the variants stay reserved for a future publisher event stream.
- **`ingest-*`** - one crate per signal family, each implements `Source`:
    - `ingest-el` - polls each rollup's `UniversalBridgeMailbox` (`New{Outbox,Inbox}Key` +
      `messageHeaderList*` view lookups) and `ComposeL2ToL2Bridge` (`ETHBridged` /
      `TokensSendQueued`) logs, and emits sealed heads. `evm.rs` is the shared chunked log poller
      (async `LogDecoder` trait) reused by `ingest-settlement`. One `ElSource` per chain in
      `EL_RPC_URLS`, so both legs of a session are observed.
    - `ingest-flashblocks` - op-rbuilder websocket pre-confs (`OpFlashblockPayload` JSON frames);
      decodes raw txs targeting the bridge into `XtRequested` events with `safe = false`.
    - `ingest-settlement` - L1 `DisputeGameFactory` compose-game creations (superblock payload is
      ABI-decoded out of the `create()` calldata) + `ComposeAnchorStateRegistry` polling for
      finalization. Mirrors the publisher's settlement ABI (`crates/coordinator/src/abi.rs` there).
- **`correlate`** - `engine.rs` `Correlator::apply()` is the heart: records each event idempotently,
  joins by session, advances the per-XT state machine, publishes stream deltas. `lifecycle.rs`
  `next_stage()` is a **pure transition table** - no I/O. The stall watchdog (`sweep_stalled`)
  rolls back XTs that never reach a sealed inclusion - the observable form of a 2PC abort.
- **`store`** - `Db` (sqlx/Postgres) + `StreamNotifier`. All canonical writes are upserts;
  `repo.rs` holds the SQL, `convert.rs` the hex/rfc3339 helpers, `notify.rs` the key-only
  `pg_notify` fan-out.
- **`indexer-core`** - `runtime.rs` connects datastores, runs migrations, spawns every source onto
  one bounded mpsc channel (backpressure), drains it through `Correlator`, runs the stall watchdog.
  `bin/indexer.rs` is the binary (`cross-scout-indexer`).

### The serving layer (apps/, packages/)

- **`apps/api`** (Bun + Hono) reads **Postgres directly** via Bun's SQL client (`db.ts`) for REST -
  it does *not* call the Rust code. It `LISTEN`s on the Postgres NOTIFY channel for row keys,
  rehydrates each into its DTO and broadcasts over `WS /v1/stream` (`stream.ts`, via the
  `postgres` npm client - Bun's SQL has no LISTEN). Postgres is the only runtime coupling
  between the Rust indexer and the api.
- **`apps/crossscout`** - React/Vite explorer, consumes REST + WS through `@cross-scout/sdk`.
- **`packages/sdk`** - shared TS types + typed api client, imported by both api and explorer.

### Crypto & EVM primitives (TypeScript)

Reach for **viem** for every EVM/crypto concern in the TS layer (`apps/api`,
`apps/crossscout`) - never hand-rolled equivalents. That covers unit conversion
(`formatUnits` / `formatEther` / `parseUnits`), address handling (`getAddress` /
`isAddress`), hashing (`keccak256`), hex + bytes (`toHex` / `fromHex` / `isHex` /
`size`), and ABI encode/decode. viem is exact and battle-tested, so it replaces
every ad-hoc bigint split, `toFixed`/`toExponential` formatter, manual checksum,
or regex hex check.

- Call viem directly at the use site; do **not** wrap it in one-line helpers
  (`weiToEth`, `baseUnitsToNumber`, …).
- Values arrive as valid strings from the DTOs, so `BigInt(x)` / `getAddress(x)`
  are trusted - no defensive `try/catch` that swallows to a zero/empty fallback;
  a malformed value should surface, not be hidden.
- viem formatting never emits scientific notation, so amounts render as
  `0.0000561`, not `5.61e-5`.
- USD is a presentation-only concern applied at serve time
  (`apps/api/src/pricing.ts`, from the `TOKEN_USD_PRICES` env map); the Rust
  indexer stays price-agnostic and never carries fiat.

## Cross-cutting invariants (respect these when editing)

- **Session = identity:** the mailbox `sessionId` (widened to bytes32) is `xt_hash`, the only
  cross-chain identity that appears on-chain. Every real signal carries it (bridge calldata/logs,
  mailbox headers), so correlation needs no off-chain lookup. The publisher's internal instance id
  never appears in any log - nothing may alias or join on it.
- **Idempotency & reorgs:** every raw event is keyed by `(chain_id, block_hash, log_index)`;
  `record_raw_event` returning false means duplicate → skip. Stage advances are **monotonic** (the
  store drops backward/`None` transitions). Flashblock pre-confs are `safe=false` until their
  sealing block confirms. On a reorg (detected from sealed-head parent hashes), `rollback_above`
  drops every log-keyed row above the common ancestor - sealed or not - and the poller rewinds to
  re-scan the replaced range, so money aggregates stay single-counted. XTs whose pre-conf never
  seals within `STALL_TIMEOUT_SECONDS` are rolled back by the watchdog.
- **Adding a new event kind** touches, in order: `types/event.rs` (variant + `kind_tag` +
  `session` if applicable) → `correlate/lifecycle.rs` (`next_stage` arm) → `correlate/engine.rs`
  (`apply` match arm) → `store/repo.rs` (persistence) → possibly a new migration. Add/extend the
  `lifecycle.rs` tests.

## Type sync (Rust DTOs → TypeScript)

The Rust `dto.rs` types are the source of truth. `bun run gen:types` runs
`export-bindings` (behind the `export` ts-rs feature) into `packages/sdk/src/generated/`, then
builds the SDK. The committed `packages/sdk/src/types.ts` is a **hand-checked mirror** you diff the
generated output against - not auto-overwritten. When you change a DTO: regenerate, reconcile
`types.ts`, and update the api's `mappers.ts`. Note a few wire types (`MailboxView`, `RollupView`)
are **TS-only** - declared in the SDK, no Rust DTO - because those endpoints are assembled in the
api.

## Database

Single migration `migrations/0001_init.sql`, applied automatically on indexer startup
(`Db::migrate`, embedded at build time). Hashes/addresses stored as `bytea` (api hex-encodes);
`raw_events` is the idempotency backbone; `chain_heads` drives reorg reconciliation; `xts.stage`
stores the numeric `Stage` discriminant and `xts.status` the safety status. Add schema changes as
new numbered migration files.
