-- CrossScout indexer - canonical schema (Postgres).
-- Core entities: XTs (keyed by mailbox session), instances, mailbox messages,
-- superblocks and their per-chain state transitions.
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
  payload      jsonb  not null,
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
-- One row per session; `xt_hash` and `instance_id` are both the bytes32-
-- widened mailbox session id.
create table if not exists xts (
  xt_hash           bytea primary key,
  instance_id       bytea not null,
  src_chain         int,
  dst_chain         int,
  chains            int[]  not null default '{}',
  sender            bytea,
  value_wei         numeric,
  status            text   not null default 'pending',  -- pending|committed|validated|finalized|failed
  stage             smallint not null default 1,        -- 1..9 | 255
  superblock_number bigint,
  block_hash        bytea,                               -- inclusion block (reorg anchor)
  first_seen_at     timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists xts_instance_idx    on xts (instance_id);
create index if not exists xts_status_idx      on xts (status);
create index if not exists xts_src_dst_idx      on xts (src_chain, dst_chain);
create index if not exists xts_superblock_idx   on xts (superblock_number);
create index if not exists xts_updated_idx      on xts (updated_at desc);

-- ── cross-chain sessions (decision surface) ───────────────────────
create table if not exists instances (
  instance_id  bytea primary key,
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
  block_hash        bytea  not null,
  log_index         int    not null,
  ts                timestamptz not null default now(),
  unique (chain_id, block_hash, log_index)
);
create index if not exists mailbox_xt_idx      on mailbox_messages (xt_hash);
create index if not exists mailbox_session_idx on mailbox_messages (session);
create index if not exists mailbox_chain_idx   on mailbox_messages (chain_id, direction);

-- ── superblocks + per-chain state transitions ─────────────────────
create table if not exists superblocks (
  number        bigint primary key,
  hash          bytea,
  parent_hash   bytea,
  status        text not null default 'proposed',        -- proposed|validated|finalized
  root_claim    bytea,
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
