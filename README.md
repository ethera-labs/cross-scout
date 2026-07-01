# CrossScout

Per-rollup cross-chain indexer for the Ethera network. One instance runs inside
each rollup and surfaces only the cross-chain transactions (XTs) that its host
rollup takes part in, feeding the CrossScout explorer.

A block explorer indexes the blocks of a single chain. CrossScout indexes the
relationships between rollups: every XT the host rollup runs with a counterparty,
rebuilt from the events emitted across the OP stack and the shared settlement
layer. Ingestion is straightforward; the hard part is correlation. A single XT
touches several sequencers, the Shared Publisher, and an L1 settlement contract,
emitting a dozen events on different chains at different times. The indexer joins
them into one lifecycle keyed by `instance_id` and serves the result over REST
and WebSocket.

## Architecture

```
   op-reth · op-rbuilder · op-node · Shared Publisher · op-succinct · L1+alt-DA
                                   │  EL logs · flashblocks WS · SBCP · L1 events
                                   ▼
   ingest-el   ingest-flashblocks   ingest-sbcp   ingest-settlement   (Rust)
                                   │  normalized DomainEvents
                                   ▼
                          correlate  (instance_id join → lifecycle SM
                                      → reorg reconciliation → upsert)
                                   │
                 ┌─────────────────┼───────────────────┐
                 ▼                 ▼                   ▼
             Postgres            Redis            (ClickHouse)
           canonical store    live pub/sub        analytics
                 │                 │
                 ▼                 ▼
                  api · Bun + TS (Hono REST + WebSocket)
                                   │
                                   ▼
                       CrossScout · React explorer
```

Every XT moves through nine lifecycle stages (`requested → scheduled →
simulating → voting → decided → included → settled → validated → finalized`),
plus a terminal `rolled_back`. The transition table lives in
[`crates/correlate/src/lifecycle.rs`](crates/correlate/src/lifecycle.rs).

## Repository layout

```
cross-scout/
├─ crates/                  # Rust workspace (cargo)
│  ├─ types/                # domain DTOs (ts-rs export), DomainEvent, Source trait
│  ├─ store/                # sqlx models, idempotent upserts, Redis publisher
│  ├─ correlate/            # instance_id join + lifecycle state machine
│  ├─ ingest-el/            # op-reth mailbox logs (+ shared EVM log poller)
│  ├─ ingest-flashblocks/   # op-rbuilder WS pre-confirmations
│  ├─ ingest-sbcp/          # Shared Publisher 2PC events
│  ├─ ingest-settlement/    # L1 superblocks, op-succinct proofs
│  └─ indexer-core/         # runtime, source registry, scheduler, binary
├─ apps/
│  ├─ api/                  # Bun + TS, Hono, REST + WebSocket
│  └─ crossscout/           # React explorer (Vite)
├─ packages/sdk/            # shared TS types + typed api client
├─ migrations/              # SQL
├─ Cargo.toml               # cargo workspace
├─ package.json             # bun workspaces
└─ turbo.json
```

## Data flow

1. Ingest. Each `ingest-*` crate implements the `Source` trait and decodes its
   raw signals into normalized `DomainEvent`s (`crates/types/src/event.rs`).
2. Correlate. `indexer-core` funnels every source onto one channel. The
   `Correlator` records each event idempotently (`raw_events` keyed by
   `(chain_id, block_hash, log_index)`), joins by `instance_id`/`session`,
   advances the per-XT state machine, handles aborts and reorgs, and upserts the
   canonical rows.
3. Serve. The Bun api reads Postgres for REST and subscribes to the Redis channel
   to push deltas over `WS /v1/stream`. The React explorer consumes both through
   `@cross-scout/sdk`.

## Endpoints

| Method | Path                      | Description                                     |
|--------|---------------------------|-------------------------------------------------|
| GET    | `/v1/xts`                 | list XTs, filter by `status`, `chain`, `period` |
| GET    | `/v1/xts/:hash`           | full XT lifecycle, votes, mailbox, block state  |
| GET    | `/v1/instances/:id`       | SBCP instance, 2PC votes, decision              |
| GET    | `/v1/superblocks/:number` | per-chain state transitions                     |
| GET    | `/v1/mailbox/:chain`      | inbox/outbox roots and message log              |
| GET    | `/v1/rollups/:chain`      | counterparty stats and recent XTs               |
| GET    | `/v1/stats`               | network totals and route volumes                |
| WS     | `/v1/stream`              | live feed of new XTs, votes, superblock changes |

## Running locally

Requires Rust ≥ 1.89 and Bun ≥ 1.3.

```bash
# datastores
docker compose up -d postgres redis

# configuration
cp .env.example .env
# Set HOST_CHAIN_ID and the host rollup's endpoints and contract addresses:
#   EL_RPC_URL, FLASHBLOCKS_WS_URL, SBCP_WS_URL, L1_RPC_URL
#   MAILBOX_ADDRESS, SBCP_COORDINATOR_ADDRESS, SETTLEMENT_ADDRESS

# indexer: applies migrations, then ingests, correlates, stores, and publishes
set -a && source .env && set +a
cargo run -p cross-scout-indexer-core --bin cross-scout-indexer

# api (new shell)
bun install
set -a && source .env && set +a
bun run api          # http://localhost:3001

# explorer (new shell)
bun run explorer     # http://localhost:5173
```

Each indexer instance is scoped to one host rollup through `HOST_CHAIN_ID`. Point
the source variables at that rollup's op-reth execution RPC, op-rbuilder
flashblocks socket, and Shared Publisher stream, plus the L1 settlement RPC.

## Development

```bash
cargo test                  # correlation state-machine tests
cargo clippy --workspace
bun run typecheck           # all TS packages
bun run gen:types           # regenerate the TS bindings from the Rust DTOs (ts-rs)
```

## Design notes

- Every raw event is keyed by `(chain_id, block_hash, log_index)`, and every
  canonical write is an upsert, so replays and overlapping backfills stay safe.
- State is anchored by block hash. Flashblock pre-confirmations stay `unsafe`
  until their sealing block confirms; after a reorg, `Db::rollback_unsafe` drops
  the unsafe events above the last common ancestor.
- A single `ABORT` vote moves the XT and its sibling chain effects to
  `rolled_back`, matching the atomicity of the two-phase commit.
- The Rust DTOs in `crates/types` are the source of truth for the wire types.
  `packages/sdk/src/types.ts` mirrors them; regenerate with `bun run gen:types`.

## License

CrossScout is licensed under the GNU General Public License v3.0. See
[`COPYING`](COPYING).
