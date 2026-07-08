-- Gas components of observed transaction receipts. fee_wei is derived
-- (gas_used * effective_gas_price_wei) so the product is stored once.

alter table mailbox_messages
  add column if not exists gas_used numeric,
  add column if not exists effective_gas_price_wei numeric;
alter table mailbox_messages
  add column if not exists fee_wei numeric
    generated always as (gas_used * effective_gas_price_wei) stored;

alter table superblocks
  add column if not exists l1_gas_used numeric,
  add column if not exists l1_effective_gas_price_wei numeric;
alter table superblocks
  add column if not exists l1_fee_wei numeric
    generated always as (l1_gas_used * l1_effective_gas_price_wei) stored;
