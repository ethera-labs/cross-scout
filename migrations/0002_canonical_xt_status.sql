-- Normalize already-included/settled XTs to the canonical product status.
update xts
set status = 'committed'
where stage in (6, 7)
  and status not in ('committed', 'validated', 'finalized', 'failed');
