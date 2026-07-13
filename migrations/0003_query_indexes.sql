-- Match filtered transaction pages, chain views and hash search to their read paths.
create index if not exists xts_status_updated_cursor_idx
  on xts (status, updated_at desc, xt_hash desc);
create index if not exists xts_dst_idx
  on xts (dst_chain);

create index if not exists mailbox_src_idx
  on mailbox_messages (src_chain);
create index if not exists mailbox_dst_idx
  on mailbox_messages (dst_chain);
create index if not exists mailbox_tx_hash_idx
  on mailbox_messages (tx_hash) where tx_hash is not null;

create index if not exists transfers_tx_hash_idx
  on transfers (tx_hash) where tx_hash is not null;
create index if not exists transfers_token_session_idx
  on transfers (token, session) where token is not null;

create index if not exists tokens_address_idx
  on tokens (address);
