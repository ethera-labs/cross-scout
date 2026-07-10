-- CrossScout indexer - canonical schema (Postgres).
-- Core entities: XTs (keyed by mailbox session), instances, mailbox messages,
-- asset transfers, token metadata, superblocks and their per-chain state
-- transitions, SBCP periods and publisher snapshots.
-- All hashes/addresses are stored as `bytea`; the api hex-encodes them.

-- ── raw event log ─────────────────────────────────────────────────
-- Idempotency backbone: every decoded on-chain event is keyed by its
-- log coordinates so replays and overlapping backfills are safe. The
-- correlation engine reads/writes canonical rows below off the back of
-- these. `safe = false` marks flashblock pre-confirmations.
create table if not exists raw_events (
  chain_id     int    not null,
  block_number bigint not null,
  block_hash   bytea  not null,
  log_index    int    not null,
  tx_hash      bytea,
  kind         text   not null,
  safe         bool   not null default true,
  observed_at  timestamptz not null default now(),
  primary key (chain_id, block_hash, log_index)
);
create index if not exists raw_events_kind_idx  on raw_events (kind);
create index if not exists raw_events_block_idx on raw_events (chain_id, block_number);

-- ── chain heads (reorg reconciliation) ────────────────────────────
-- Last block hash seen per chain, plus the safe head. On a reorg the
-- correlation engine rolls affected rows back to the last common ancestor.
create table if not exists chain_heads (
  chain_id      int    primary key,
  head_number   bigint not null,
  head_hash     bytea  not null,
  safe_number   bigint not null default 0,
  updated_at    timestamptz not null default now()
);

-- ── cross-chain transactions ──────────────────────────────────────
-- One row per session; `xt_hash` is the bytes32-widened mailbox session id,
-- the only cross-chain identity that appears on-chain. `value_wei` carries
-- native ETH only; token amounts live in `transfers`. Stage timestamps
-- record the first time each observable milestone was reached.
create table if not exists xts (
  xt_hash           bytea primary key,
  src_chain         int,
  dst_chain         int,
  chains            int[]  not null default '{}',
  sender            bytea,
  receiver          bytea,
  label             text,
  value_wei         numeric,
  status            text   not null default 'pending',  -- pending|committed|validated|finalized|failed
  stage             smallint not null default 1,        -- 1..9 | 255
  superblock_number bigint,
  block_hash        bytea,                               -- inclusion block (reorg anchor)
  src_tx_hash       bytea,                               -- originating bridge call
  first_seen_at     timestamptz not null default now(),
  preconfirmed_at   timestamptz,
  included_at       timestamptz,
  settled_at        timestamptz,
  finalized_at      timestamptz,
  failed_at         timestamptz,
  updated_at        timestamptz not null default now()
);
create index if not exists xts_status_idx      on xts (status);
create index if not exists xts_src_dst_idx     on xts (src_chain, dst_chain);
create index if not exists xts_superblock_idx  on xts (superblock_number);
create index if not exists xts_updated_idx     on xts (updated_at desc);
create index if not exists xts_first_seen_idx  on xts (first_seen_at desc);
create index if not exists xts_sender_idx      on xts (sender);
create index if not exists xts_receiver_idx    on xts (receiver);

-- ── cross-chain sessions (decision surface) ───────────────────────
-- Keyed by the mailbox session. The publisher's internal instance id is
-- never observable on-chain, so no column pretends to carry it.
create table if not exists instances (
  session      bytea primary key,
  xt_hash      bytea references xts (xt_hash),
  participants int[] not null default '{}',
  decision     text  not null default 'pending',        -- commit|abort|pending
  started_at   timestamptz,
  decided_at   timestamptz
);
create index if not exists instances_xt_idx on instances (xt_hash);

-- ── mailbox messages (idempotent on log coords) ───────────────────
create table if not exists mailbox_messages (
  id                bigserial primary key,
  direction         text not null,                       -- in|out
  src_chain         int,
  dst_chain         int,
  session           bytea,
  sender            bytea,
  receiver          bytea,
  label             text,
  xt_hash           bytea,
  superblock_number bigint,
  chain_id          int    not null,
  block_number      bigint,
  block_hash        bytea  not null,
  log_index         int    not null,
  tx_hash           bytea,
  ts                timestamptz not null default now(),
  unique (chain_id, block_hash, log_index)
);
create index if not exists mailbox_xt_idx      on mailbox_messages (xt_hash);
create index if not exists mailbox_session_idx on mailbox_messages (session);
create index if not exists mailbox_chain_idx   on mailbox_messages (chain_id, direction);
create index if not exists mailbox_ts_idx      on mailbox_messages (ts desc);

-- ── asset transfers (source-leg bridge events) ────────────────────
-- One row per `ETHBridged` / `TokensSendQueued`, observed on the source
-- rollup only, so each transfer counts exactly once network-wide. `token`
-- null means native ETH; amounts are raw base units (decimals in `tokens`).
create table if not exists transfers (
  id           bigserial primary key,
  session      bytea  not null,
  kind         text   not null check (kind in ('eth', 'erc20')),
  token        bytea,
  amount       numeric not null,
  src_chain    int    not null,
  dst_chain    int    not null,
  sender       bytea  not null,
  receiver     bytea  not null,
  message_id   bytea,
  chain_id     int    not null,
  block_number bigint,
  block_hash   bytea  not null,
  log_index    int    not null,
  tx_hash      bytea,
  safe         bool   not null default true,
  ts           timestamptz not null default now(),
  unique (chain_id, block_hash, log_index)
);
create index if not exists transfers_session_idx on transfers (session);
create index if not exists transfers_token_idx   on transfers (token, ts desc);
create index if not exists transfers_ts_idx      on transfers (ts desc);
create index if not exists transfers_route_idx   on transfers (src_chain, dst_chain, ts desc);

-- ── OP Stack L1/L2 bridge operations ─────────────────────────────
-- Standard deposits and withdrawals are not mailbox sessions, so they are
-- tracked separately from XTs.
create table if not exists deposits (
  source_hash     bytea primary key,
  l2_chain_id     int    not null,
  sender          bytea  not null,
  receiver        bytea  not null,
  mint_wei        numeric not null,
  value_wei       numeric not null,
  gas_limit       numeric not null,
  is_creation     bool   not null,
  status          text   not null default 'initiated',
  l1_chain_id     int    not null,
  l1_block_number bigint not null,
  l1_block_hash   bytea  not null,
  l1_log_index    int    not null,
  l1_tx_hash      bytea,
  initiated_at    timestamptz not null,
  updated_at      timestamptz not null default now(),
  unique (l1_chain_id, l1_block_hash, l1_log_index)
);
create index if not exists deposits_chain_status_idx on deposits (l2_chain_id, status);
create index if not exists deposits_updated_idx on deposits (updated_at desc);
create index if not exists deposits_sender_idx on deposits (sender);
create index if not exists deposits_receiver_idx on deposits (receiver);

create table if not exists withdrawals (
  withdrawal_hash          bytea primary key,
  l2_chain_id              int    not null,
  nonce                    numeric,
  sender                   bytea,
  target                   bytea,
  value_wei                numeric,
  gas_limit                numeric,
  status                   text   not null default 'initiated',
  finalized_success        bool,

  initiated_chain_id       int,
  initiated_block_number   bigint,
  initiated_block_hash     bytea,
  initiated_log_index      int,
  initiated_tx_hash        bytea,
  initiated_at             timestamptz,

  proven_l1_chain_id       int,
  proven_l1_block_number   bigint,
  proven_l1_block_hash     bytea,
  proven_l1_log_index      int,
  proven_l1_tx_hash        bytea,
  proven_at                timestamptz,

  finalized_l1_chain_id    int,
  finalized_l1_block_number bigint,
  finalized_l1_block_hash  bytea,
  finalized_l1_log_index   int,
  finalized_l1_tx_hash     bytea,
  finalized_at             timestamptz,

  updated_at               timestamptz not null default now(),
  unique (initiated_chain_id, initiated_block_hash, initiated_log_index),
  unique (proven_l1_chain_id, proven_l1_block_hash, proven_l1_log_index),
  unique (finalized_l1_chain_id, finalized_l1_block_hash, finalized_l1_log_index)
);
create index if not exists withdrawals_chain_status_idx on withdrawals (l2_chain_id, status);
create index if not exists withdrawals_updated_idx on withdrawals (updated_at desc);
create index if not exists withdrawals_sender_idx on withdrawals (sender);
create index if not exists withdrawals_target_idx on withdrawals (target);

-- ── token metadata (lazily resolved via ERC-20 static calls) ──────
-- A row appears when a transfer first references the token; the resolver
-- fills symbol/name/decimals and stamps `refreshed_at` when it succeeds.
create table if not exists tokens (
  chain_id     int   not null,
  address      bytea not null,
  symbol       text,
  name         text,
  decimals     int,
  first_seen_at timestamptz not null default now(),
  refreshed_at  timestamptz,
  primary key (chain_id, address)
);
create index if not exists tokens_unresolved_idx on tokens (refreshed_at) where refreshed_at is null;

-- ── superblocks + per-chain state transitions ─────────────────────
create table if not exists superblocks (
  number        bigint primary key,
  hash          bytea,
  parent_hash   bytea,
  status        text not null default 'proposed',        -- proposed|validated|finalized
  root_claim    bytea,
  game_address  bytea,
  xt_count      int  not null default 0,
  prove_ms      int,
  l1_tx         bytea,
  l1_block      bigint,
  proposed_at   timestamptz,
  validated_at  timestamptz,
  finalized_at  timestamptz
);
create index if not exists superblocks_status_idx on superblocks (status);

create table if not exists superblock_chains (
  superblock_number bigint not null,
  chain_id          int    not null,
  l2_block          bigint,
  pre_root          bytea,
  post_root         bytea,
  config_hash       bytea,
  primary key (superblock_number, chain_id)
);

-- ── SBCP periods (observed via the publisher stats poller) ────────
create table if not exists periods (
  period_id         bigint primary key,
  superblock_number bigint,
  first_seen_at     timestamptz not null default now(),
  last_seen_at      timestamptz not null default now()
);

-- ── publisher snapshots (coordinator liveness series) ─────────────
-- Sampled from the publisher's stats endpoint; pruned on insert so the
-- series stays bounded.
create table if not exists publisher_snapshots (
  ts                timestamptz primary key default now(),
  period_id         bigint not null,
  next_superblock   bigint not null,
  last_finalized    bigint not null,
  queued            int    not null,
  active_xts        int    not null,
  active_chains     int    not null,
  connections       int    not null,
  registered_chains int    not null default 0,
  pending_proofs    int    not null default 0
);
