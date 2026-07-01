# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

CrossScout is a **per-rollup cross-chain indexer** for the Ethera network. One instance runs
inside each rollup's infra (`HOST_CHAIN_ID`) and surfaces only the cross-chain transactions (XTs)
that host rollup participates in. The hard problem is **correlation, not ingestion**: a single XT
emits ~a dozen events across N sequencers, the Shared Publisher, and an L1 settlement contract, at
different times on different chains. The indexer stitches them into one lifecycle keyed by
`instance_id`/`session` and serves the joined view over REST + WebSocket.

`README.md` has the full architecture diagram, endpoint table, and design notes - read it first.

## Commands

Everything reads `.env` (copy from `.env.example`; `USE_MOCK_SOURCES=true` drives the whole
pipeline with synthetic XT lifecycles, no rollup infra needed). The indexer and the api both need
the env exported into the shell.

```bash
make up                     # start postgres + redis + clickhouse (docker compose)
make dev                    # indexer + api + explorer together (also runs `up` + bun install)
make indexer / api / explorer   # run one process (each sources .env for you)

# Rust (workspace)
cargo test --workspace                                   # correlation/state-machine tests
cargo test -p cross-scout-correlate happy_path_walks_all_nine_stages   # a single test
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

## Architecture

### The Rust pipeline (crates/)

Data flows **Source → DomainEvent → Correlator → Db (Postgres) + Redis**, all wired by
`indexer-core`:

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
    `XtStatus`. `Stage` is the single source of truth, re-exported by `correlate`.
- **`ingest-*`** - one crate per signal family, each implements `Source`: `ingest-el` (op-reth
  mailbox + SBCP logs; `evm.rs` is a shared EVM log poller), `ingest-flashblocks` (op-rbuilder WS
  pre-confs), `ingest-sbcp` (2PC votes), `ingest-settlement` (L1 superblocks). `registry.rs`
  chooses live sources vs the single `MockSource` based on `USE_MOCK_SOURCES`.
- **`correlate`** - `engine.rs` `Correlator::apply()` is the heart: records each event idempotently,
  joins by `instance_id`/`session`, advances the per-XT state machine, publishes stream deltas.
  `lifecycle.rs` `next_stage()` is a **pure transition table** - no I/O - heavily unit-tested.
- **`store`** - `Db` (sqlx/Postgres) + `RedisPublisher`. All canonical writes are upserts;
  `repo.rs` holds the SQL, `convert.rs` the hex/rfc3339 helpers, `redis.rs` the fan-out publish.
- **`indexer-core`** - `runtime.rs` connects datastores, runs migrations, spawns every source onto
  one bounded mpsc channel (backpressure), drains it through `Correlator`, runs the stall watchdog.
  `bin/indexer.rs` is the binary (`cross-scout-indexer`).

### The serving layer (apps/, packages/)

- **`apps/api`** (Bun + Hono) reads **Postgres directly** via Bun's SQL client (`db.ts`) for REST -
  it does *not* call the Rust code. It subscribes to the **Redis** channel and rebroadcasts deltas
  over `WS /v1/stream` (`stream.ts`). Redis is the only runtime coupling between the Rust indexer
  and the api; Postgres has two independent readers (the Rust writer + the Bun reader).
- **`apps/crossscout`** - React/Vite explorer, consumes REST + WS through `@cross-scout/sdk`.
- **`packages/sdk`** - shared TS types + typed api client, imported by both api and explorer.

## Cross-cutting invariants (respect these when editing)

- **Idempotency & reorgs:** every raw event is keyed by `(chain_id, block_hash, log_index)`;
  `record_raw_event` returning false means duplicate → skip. Stage advances are **monotonic** (the
  store drops backward/`None` transitions). Flashblock pre-confs are `safe=false` until their
  sealing block confirms; `rollback_unsafe` drops unsafe rows above the last common ancestor on a
  reorg. A single `ABORT` vote (`InstanceDecided{commit:false}`) sends the XT to `RolledBack` from
  any stage (2PC atomicity).
- **Adding a new event kind** touches, in order: `types/event.rs` (variant + `kind_tag` +
  `instance_id`/`xt_hash` if applicable) → `correlate/lifecycle.rs` (`next_stage` arm) →
  `correlate/engine.rs` (`apply` match arm) → `store/repo.rs` (persistence) → possibly a new
  migration. Add/extend the `lifecycle.rs` tests.

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
