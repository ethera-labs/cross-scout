# CrossScout

Per-rollup cross-chain indexer for the Ethera network. One instance runs inside
each rollup and surfaces only the cross-chain transactions (XTs) that its host
rollup takes part in, feeding the CrossScout explorer.

A block explorer indexes the blocks of a single chain. CrossScout indexes the
relationships between rollups: every XT the host rollup runs with a counterparty,
rebuilt from the events emitted across the OP stack and the shared settlement
layer. Ingestion is straightforward; the hard part is correlation. A single XT
touches several sequencers and an L1 settlement contract, leaving signals on
different chains at different times. The indexer joins them into one lifecycle
keyed by the mailbox **session id** and serves the result over REST and
WebSocket.

## Architecture

```
     op-reth (per rollup)        op-rbuilder        L1 (portal + dispute games)
     mailbox + bridge logs      flashblocks WS      OptimismPortal · DGF · ASR
              │                       │                      │
              ▼                       ▼                      ▼
         ingest-el          ingest-flashblocks      ingest-bridge · ingest-settlement
                                      │  normalized DomainEvents
                                      ▼
                             correlate  (session join → lifecycle SM
                                         → reorg reconciliation → upsert)
                                      │
                                      ▼
                                  Postgres
                     canonical store · NOTIFY live stream
                                      │
                                      ▼
              CrossScout · Bun + TS (Hono REST + WebSocket, serves the
                            built React explorer from the same port)
```

The observable lifecycle is `requested → included → settled → finalized`, plus
the terminal `rolled_back`:

- **requested** - a bridge call carrying the session was seen, either
  pre-confirmed in a flashblock (unsafe) or in a sealed bridge log.
- **included** - the mailbox write (`NewOutboxKey`/`NewInboxKey`) landed in a
  sealed block. The publisher only lets builders execute XTs its 2PC committed,
  so a sealed mailbox write is also the observable commit.
- **settled** - the publisher created the superblock's compose dispute game on
  the L1 `DisputeGameFactory`.
- **finalized** - the `ComposeAnchorStateRegistry` anchored the superblock
  (its game resolved).
- **rolled_back** - a pre-confirmation that never sealed within the stall
  window: the observable form of a 2PC abort.

The publisher's intermediate 2PC phases (`scheduled`, `simulating`, `voting`,
`decided`) happen off-chain over QUIC and expose no public signal today; the
stages stay reserved in the schema for when the publisher grows an event
stream. The transition table lives in
[`crates/correlate/src/lifecycle.rs`](crates/correlate/src/lifecycle.rs).

## Repository layout

```
cross-scout/
├─ crates/                  # Rust workspace (cargo)
│  ├─ types/                # domain DTOs (ts-rs export), DomainEvent, Source trait
│  ├─ store/                # sqlx models, idempotent upserts, NOTIFY publisher
│  ├─ correlate/            # session join + lifecycle state machine
│  ├─ ingest-el/            # mailbox + bridge logs per rollup (+ shared EVM log poller)
│  ├─ ingest-bridge/        # OP Stack deposits and withdrawals
│  ├─ ingest-flashblocks/   # op-rbuilder WS pre-confirmations
│  ├─ ingest-settlement/    # L1 dispute games + anchor registry
│  └─ indexer-core/         # runtime, source registry, scheduler, binary
├─ apps/
│  ├─ api/                  # Bun + TS, Hono, REST + WebSocket, serves the built explorer
│  └─ crossscout/           # React explorer (Vite)
├─ packages/sdk/            # shared TS types + typed api client
├─ migrations/              # SQL
├─ Cargo.toml               # cargo workspace
├─ package.json             # bun workspaces
└─ turbo.json
```

## Data flow

1. Ingest. Each `ingest-*` crate implements the `Source` trait and decodes its
   raw signals into normalized `DomainEvent`s (`crates/types/src/event.rs`):
   mailbox key logs are joined with their headers via the contract's
   append-only `messageHeaderList*` views; flashblock frames are unpacked and
   bridge-targeted txs decoded from calldata; OP Stack portal/message-passer
   logs produce deposit and withdrawal operations; dispute-game creations carry
   the whole superblock payload in their `create()` calldata.
2. Correlate. `indexer-core` funnels every source onto one channel. The
   `Correlator` records each event idempotently (`raw_events` keyed by
   `(chain_id, block_hash, log_index)`), joins by session, advances the per-XT
   state machine, handles aborts and reorgs, and upserts the canonical rows.
3. Serve. The Bun api reads Postgres for REST and listens on its NOTIFY channel
   for row keys, rehydrating each into a DTO pushed over `WS /v1/stream`. It also
   serves the built React explorer from the same port, which consumes both
   through `@cross-scout/sdk`.

## Endpoints

| Method | Path                            | Description                                                |
|--------|---------------------------------|------------------------------------------------------------|
| GET    | `/health`                       | liveness - process is up                                   |
| GET    | `/ready`                        | readiness - Postgres answers                               |
| GET    | `/v1/xts`                       | list XTs, filter by `status`, `chain`, `address`, `token`  |
| GET    | `/v1/xts/:hash`                 | full XT lifecycle, transfers, mailbox, superblock, tokens  |
| GET    | `/v1/deposits`                  | L1->L2 deposits, filter by `status`, `chain`, `address`    |
| GET    | `/v1/deposits/:sourceHash`      | one L1->L2 deposit by source hash                          |
| GET    | `/v1/withdrawals`               | L2->L1 withdrawals, filter by `status`, `chain`, `address` |
| GET    | `/v1/withdrawals/:hash`         | one L2->L1 withdrawal by withdrawal hash                   |
| GET    | `/v1/instances/:id`             | cross-chain session and its derived decision               |
| GET    | `/v1/superblocks/:number`       | per-chain state transitions and dispute game               |
| GET    | `/v1/mailbox/:chain`            | inbox/outbox roots and message log                         |
| GET    | `/v1/rollups/:chain`            | counterparty stats and recent XTs                          |
| GET    | `/v1/stats`                     | network totals, 24h window, commit rate, route volumes     |
| GET    | `/v1/analytics/activity`        | zero-filled activity time series (`window`, `interval`)    |
| GET    | `/v1/analytics/routes`          | per-route transfer counts and ETH volume (`window`)        |
| GET    | `/v1/analytics/assets`          | top transferred assets with token metadata (`window`)      |
| GET    | `/v1/analytics/assets/activity` | per-asset time series (`token`, `window`)                  |
| GET    | `/v1/search`                    | resolve a hash, address, token or superblock number        |
| GET    | `/v1/network`                   | publisher snapshot, period history, queue-depth series     |
| WS     | `/v1/stream`                    | live feed of new XTs and superblock changes                |

## Running locally

Requires Rust ≥ 1.89 and Bun ≥ 1.3.

```bash
# datastore
docker compose up -d postgres

# configuration - pick a preset:
cp .env.localnet .env     # against the local-testnet L2 stack
cp .env.stage .env        # against sepolia-stage
# or start from the annotated template:
cp .env.example .env

# indexer: applies migrations, then ingests, correlates, stores, and publishes
set -a && source .env && set +a
cargo run -p cross-scout-indexer-core --bin cross-scout-indexer

# api + explorer (new shell): build the explorer once, then the api serves
# both from one port
bun install
bun run --cwd apps/crossscout build
set -a && source .env && set +a
bun run api          # http://localhost:3001

# explorer with hot reload instead (new shell, api still required above)
bun run explorer     # http://localhost:5173, talks to the api on :3001
```

Each indexer instance is scoped to one host rollup through `HOST_CHAIN_ID`.
`EL_RPC_URLS` lists every participating rollup (host + counterparties) as
`chain_id=url` pairs so both legs of a session are observed;
`FLASHBLOCKS_WS_URLS` is optional and only adds pre-confirmations.
`PORTAL_ADDRESSES` lists each rollup's L1 `OptimismPortal` as
`chain_id=address` pairs for deposits and withdrawal prove/finalize legs.

## Development

```bash
cargo test                  # correlation state-machine + decode tests
cargo clippy --workspace
bun run typecheck           # all TS packages
bun run gen:types           # regenerate the TS bindings from the Rust DTOs (ts-rs)
```

## Design notes

- The mailbox `sessionId` (widened to bytes32) is the XT identity: every real
  signal carries it, so correlation needs no off-chain lookup.
- Every raw event is keyed by `(chain_id, block_hash, log_index)`, and every
  canonical write is an upsert, so replays and overlapping backfills stay safe.
- State is anchored by block hash. Flashblock pre-confirmations stay `unsafe`
  until their sealing block confirms. After a reorg, `Db::rollback_above` drops
  every log-keyed row above the last common ancestor and the poller re-scans
  the replaced range on the new branch. A pre-confirmation that never seals
  within `STALL_TIMEOUT_SECONDS` is rolled back - the observable form of a
  2PC abort.
- The Rust DTOs in `crates/types` are the source of truth for the wire types.
  `packages/sdk/src/types.ts` mirrors them; regenerate with `bun run gen:types`.

## License

CrossScout is licensed under the GNU General Public License v3.0. See
[`COPYING`](COPYING).
