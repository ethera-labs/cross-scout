// Postgres access via Bun's built-in SQL client. Each function returns SDK
// DTOs, mapped from snake_case rows. Filters use null-guarded predicates so one
// parameterized query covers the optional-filter cases.

import { SQL } from 'bun';
import type {
  ActivityPoint,
  AssetVolume,
  Deposit,
  DepositPage,
  Instance,
  MailboxView,
  NetworkStats,
  NetworkView,
  RollupView,
  RouteVolume,
  SearchResponse,
  Superblock,
  Withdrawal,
  WithdrawalPage,
  XtDetail,
  XtPage,
} from '@cross-scout/sdk';
import { fromHex, toHex, toIso } from './convert.ts';
import type { IntervalParam, WindowParam } from './params.ts';
import { windowInterval } from './params.ts';
import {
  enrichMailboxFees,
  enrichSuperblockFees,
  enrichTransfersUsd,
  enrichXtUsd,
} from './pricing.ts';
import {
  toActivityPoint,
  toAssetVolume,
  toDeposit,
  toInstance,
  toMailbox,
  toPeriod,
  toSnapshot,
  toSuperblock,
  toSuperblockChain,
  toTokenMeta,
  toTransfer,
  toWithdrawal,
  toXt,
} from './mappers.ts';

const url =
  process.env.DATABASE_URL ?? 'postgres://crossscout:crossscout@localhost:5432/crossscout';

export const sql = new SQL(url);

export interface ListXtsQuery {
  status?: string;
  chain?: number;
  limit?: number;
  cursor?: string;
  address?: Uint8Array | null;
  token?: Uint8Array | null;
}

export async function listXts(p: ListXtsQuery): Promise<XtPage> {
  const limit = Math.min(Math.max(p.limit ?? 50, 1), 200);
  const status = p.status ?? null;
  const chain = p.chain ?? null;
  const address = p.address ?? null;
  const token = p.token ?? null;

  // Compound `<updated_at>|<xt_hash>` cursor: the tiebreaker keeps rows that
  // share the boundary timestamp from being skipped between pages.
  const [cursorTsRaw, cursorHashRaw] = (p.cursor ?? '').split('|');
  const cursorTs = cursorTsRaw || null;
  const cursorHash = cursorHashRaw ? fromHex(cursorHashRaw) : null;

  const rows = await sql`
    select distinct on (x.updated_at, x.xt_hash) x.*
    from xts x
    ${token != null ? sql`join transfers tr on tr.session = x.xt_hash and tr.token = ${token}` : sql``}
    where (${status}::text is null or x.status = ${status})
      and (${chain}::int is null or x.src_chain = ${chain} or x.dst_chain = ${chain})
      and (${cursorTs}::timestamptz is null
           or x.updated_at < ${cursorTs}::timestamptz
           or (x.updated_at = ${cursorTs}::timestamptz
               and ${cursorHash}::bytea is not null and x.xt_hash < ${cursorHash}::bytea))
      and (${address}::bytea is null or x.sender = ${address}::bytea or x.receiver = ${address}::bytea)
    order by x.updated_at desc, x.xt_hash desc
    limit ${limit}
  `;

  const last = rows[rows.length - 1];
  const nextCursor =
    rows.length === limit && last ? `${toIso(last.updated_at)}|${toHex(last.xt_hash)}` : null;
  return { items: rows.map(toXt), nextCursor };
}

export interface ListBridgeOpsQuery {
  status?: string;
  chain?: number;
  limit?: number;
  cursor?: string;
  address?: Uint8Array | null;
}

function cursorParts(cursor: string | undefined): [string | null, Uint8Array | null] {
  const [cursorTsRaw, cursorHashRaw] = (cursor ?? '').split('|');
  return [cursorTsRaw || null, cursorHashRaw ? fromHex(cursorHashRaw) : null];
}

export async function listDeposits(p: ListBridgeOpsQuery): Promise<DepositPage> {
  const limit = Math.min(Math.max(p.limit ?? 50, 1), 200);
  const status = p.status ?? null;
  const chain = p.chain ?? null;
  const address = p.address ?? null;
  const [cursorTs, cursorHash] = cursorParts(p.cursor);

  const rows = await sql`
    select * from deposits
    where (${status}::text is null or status = ${status})
      and (${chain}::int is null or l2_chain_id = ${chain})
      and (${address}::bytea is null or sender = ${address}::bytea or receiver = ${address}::bytea)
      and (${cursorTs}::timestamptz is null
           or updated_at < ${cursorTs}::timestamptz
           or (updated_at = ${cursorTs}::timestamptz
               and ${cursorHash}::bytea is not null and source_hash < ${cursorHash}::bytea))
    order by updated_at desc, source_hash desc
    limit ${limit}
  `;

  const last = rows[rows.length - 1];
  const nextCursor =
    rows.length === limit && last ? `${toIso(last.updated_at)}|${toHex(last.source_hash)}` : null;
  return { items: rows.map(toDeposit), nextCursor };
}

export async function getDeposit(sourceHashHex: string): Promise<Deposit | null> {
  const buf = fromHex(sourceHashHex);
  const [row] = await sql`select * from deposits where source_hash = ${buf}`;
  return row ? toDeposit(row) : null;
}

export async function listWithdrawals(p: ListBridgeOpsQuery): Promise<WithdrawalPage> {
  const limit = Math.min(Math.max(p.limit ?? 50, 1), 200);
  const status = p.status ?? null;
  const chain = p.chain ?? null;
  const address = p.address ?? null;
  const [cursorTs, cursorHash] = cursorParts(p.cursor);

  const rows = await sql`
    select * from withdrawals
    where (${status}::text is null or status = ${status})
      and (${chain}::int is null or l2_chain_id = ${chain})
      and (${address}::bytea is null or sender = ${address}::bytea or target = ${address}::bytea)
      and (${cursorTs}::timestamptz is null
           or updated_at < ${cursorTs}::timestamptz
           or (updated_at = ${cursorTs}::timestamptz
               and ${cursorHash}::bytea is not null and withdrawal_hash < ${cursorHash}::bytea))
    order by updated_at desc, withdrawal_hash desc
    limit ${limit}
  `;

  const last = rows[rows.length - 1];
  const nextCursor =
    rows.length === limit && last ? `${toIso(last.updated_at)}|${toHex(last.withdrawal_hash)}` : null;
  return { items: rows.map(toWithdrawal), nextCursor };
}

export async function getWithdrawal(withdrawalHashHex: string): Promise<Withdrawal | null> {
  const buf = fromHex(withdrawalHashHex);
  const [row] = await sql`select * from withdrawals where withdrawal_hash = ${buf}`;
  return row ? toWithdrawal(row) : null;
}

export async function getInstance(sessionHex: string): Promise<Instance | null> {
  const buf = fromHex(sessionHex);
  const [row] = await sql`select * from instances where session = ${buf}`;
  return row ? toInstance(row) : null;
}

export async function getSuperblock(number: number): Promise<Superblock | null> {
  const [row] = await sql`select * from superblocks where number = ${number}`;
  if (!row) return null;
  const chainRows = await sql`
    select * from superblock_chains where superblock_number = ${number} order by chain_id`;
  return enrichSuperblockFees(toSuperblock(row, chainRows.map(toSuperblockChain)));
}

export async function listSuperblocks(limit = 50): Promise<Superblock[]> {
  const capped = Math.min(Math.max(limit, 1), 200);
  const rows = await sql`select * from superblocks order by number desc limit ${capped}`;
  if (rows.length === 0) return [];

  const numbers = rows.map((r: any) => Number(r.number));
  const chainRows = await sql`
    select * from superblock_chains where superblock_number in ${sql(numbers)}
    order by chain_id`;
  const byNumber = new Map<number, any[]>();
  for (const cr of chainRows) {
    const n = Number(cr.superblock_number);
    const list = byNumber.get(n) ?? [];
    list.push(cr);
    byNumber.set(n, list);
  }
  return rows.map((r: any) =>
    toSuperblock(r, (byNumber.get(Number(r.number)) ?? []).map(toSuperblockChain)),
  );
}

export async function getXtDetail(hashHex: string): Promise<XtDetail | null> {
  const buf = fromHex(hashHex);
  const [xtRow] = await sql`select * from xts where xt_hash = ${buf}`;
  if (!xtRow) return null;

  const xt = enrichXtUsd(toXt(xtRow));
  // instances.session = xt_hash (same bytes32 identity)
  const instance = await getInstance(toHex(buf)!);
  const mbRows = await sql`select * from mailbox_messages where xt_hash = ${buf} order by ts`;
  const superblock =
    xtRow.superblock_number != null ? await getSuperblock(Number(xtRow.superblock_number)) : null;
  const transferRows = await sql`
    select * from transfers where session = ${buf} and safe = true order by ts`;
  const tokenRows = await sql`
    select distinct tk.* from tokens tk
    join transfers tr on tr.chain_id = tk.chain_id and tr.token = tk.address
    where tr.session = ${buf}`;
  const tokens = tokenRows.map(toTokenMeta);

  return {
    xt,
    instance,
    mailbox: mbRows.map(toMailbox).map(enrichMailboxFees),
    superblock,
    transfers: enrichTransfersUsd(transferRows.map(toTransfer), tokens),
    tokens,
  };
}

export async function getMailboxView(chain: number): Promise<MailboxView> {
  const rows = await sql`
    select * from mailbox_messages
    where chain_id = ${chain} or src_chain = ${chain} or dst_chain = ${chain}
    order by ts desc limit 100`;
  const [counts] = await sql`
    select
      count(*) filter (where direction = 'in')::int as in_count,
      count(*) filter (where direction = 'out')::int as out_count
    from mailbox_messages
    where chain_id = ${chain} or src_chain = ${chain} or dst_chain = ${chain}`;

  return {
    chainId: chain,
    inCount: counts?.in_count ?? 0,
    outCount: counts?.out_count ?? 0,
    messages: rows.map(toMailbox),
  };
}

export async function getRollupView(chain: number): Promise<RollupView> {
  const [counts] = await sql`
    select
      count(*)::int as xt_count,
      count(*) filter (where status = 'finalized')::int as finalized,
      count(*) filter (where status = 'committed')::int as committed,
      count(*) filter (where status = 'pending')::int as pending
    from xts where src_chain = ${chain} or dst_chain = ${chain}`;
  const recent = await sql`
    select * from xts where src_chain = ${chain} or dst_chain = ${chain}
    order by updated_at desc limit 10`;

  return {
    chainId: chain,
    xtCount: counts?.xt_count ?? 0,
    finalized: counts?.finalized ?? 0,
    committed: counts?.committed ?? 0,
    pending: counts?.pending ?? 0,
    recentXts: recent.map(toXt),
  };
}

export async function getStats(hostChain: number): Promise<NetworkStats> {
  const [c] = await sql`
    select
      count(*)::int as total,
      count(*) filter (where status = 'pending')::int as pending,
      count(*) filter (where status = 'committed')::int as committed,
      count(*) filter (where status = 'validated')::int as validated,
      count(*) filter (where status = 'finalized')::int as finalized,
      count(*) filter (where status = 'failed')::int as failed
    from xts`;
  const [sb] = await sql`select count(*)::int as n, avg(prove_ms)::float as avg from superblocks`;

  // Routes: xt count (from xts) + transfers count per (src,dst), all-time
  const routeRows = await sql`
    select
      x.src_chain,
      x.dst_chain,
      count(distinct x.xt_hash)::int as count,
      coalesce(sum(case when t.kind = 'eth' then t.amount else 0 end), 0)::text as value_wei,
      count(t.id)::int as transfers
    from xts x
    left join transfers t on t.session = x.xt_hash and t.safe = true
    where x.src_chain is not null and x.dst_chain is not null
    group by x.src_chain, x.dst_chain
    order by count desc limit 20`;

  // 24h window stats; transfers window on their own ts, not the XT's first
  // sighting, so late-sealing transfers land in the right window.
  const [w] = await sql`
    select
      (select count(*)::int from xts
        where first_seen_at >= now() - interval '24 hours') as xts,
      count(t.id)::int as transfers,
      coalesce(sum(case when t.kind = 'eth' then t.amount else 0 end), 0)::text as volume_wei,
      (select count(*)::int from mailbox_messages
        where ts >= now() - interval '24 hours') as messages
    from transfers t
    where t.safe = true and t.ts >= now() - interval '24 hours'`;

  // commitRate = decided / max(1, total decided + pending) - excludes failed
  const total = Number(c?.total ?? 0);
  const pending = Number(c?.pending ?? 0);
  const failed = Number(c?.failed ?? 0);
  const decided = total - pending - failed;
  const commitRate = decided > 0 ? decided / Math.max(1, total - pending) : null;

  const [lastFin] = await sql`
    select max(number)::int as n from superblocks where status = 'finalized'`;

  const routes: RouteVolume[] = routeRows.map((r: any) => ({
    srcChain: Number(r.src_chain),
    dstChain: Number(r.dst_chain),
    count: Number(r.count),
    valueWei: String(r.value_wei),
    transfers: Number(r.transfers),
  }));

  return {
    hostChain,
    totalXts: total,
    pending,
    committed: Number(c?.committed ?? 0),
    validated: Number(c?.validated ?? 0),
    finalized: Number(c?.finalized ?? 0),
    failed,
    superblocks: sb?.n ?? 0,
    avgProveMs: sb?.avg ?? null,
    routes,
    window24h: {
      xts: Number(w?.xts ?? 0),
      transfers: Number(w?.transfers ?? 0),
      volumeWei: String(w?.volume_wei ?? '0'),
      messages: Number(w?.messages ?? 0),
    },
    commitRate,
    lastFinalizedSuperblock: lastFin?.n ?? null,
  };
}

export async function getActivity(
  window: WindowParam,
  interval: IntervalParam,
): Promise<ActivityPoint[]> {
  const ivl = windowInterval(window);
  const trunc = interval === 'hour' ? 'hour' : 'day';
  // Buckets are built and joined in naive UTC so results do not depend on the
  // server's session timezone; generate_series zero-fills the gaps. The
  // unbounded window starts at the oldest observed row instead of a fixed
  // horizon.
  const rows = await sql`
    with bounds as (
      select
        date_trunc(${trunc}, ${
          ivl !== null
            ? sql`(now() - ${ivl}::interval) at time zone 'utc'`
            : sql`coalesce(least((select min(first_seen_at) from xts),
                                 (select min(ts) from transfers where safe = true)),
                           now()) at time zone 'utc'`
        }) as start_ts,
        date_trunc(${trunc}, now() at time zone 'utc') as end_ts
    ),
    buckets as (
      select generate_series(b.start_ts, b.end_ts, ${'1 ' + trunc}::interval) as bucket
      from bounds b
    ),
    xt_agg as (
      select date_trunc(${trunc}, first_seen_at at time zone 'utc') as bucket, count(*)::int as cnt
      from xts
      where ${ivl !== null ? sql`first_seen_at >= now() - ${ivl}::interval` : sql`true`}
      group by 1
    ),
    tr_agg as (
      select
        date_trunc(${trunc}, ts at time zone 'utc') as bucket,
        count(*)::int as tr_cnt,
        coalesce(sum(case when kind = 'eth' then amount else 0 end), 0)::text as vol
      from transfers
      where safe = true
        and ${ivl !== null ? sql`ts >= now() - ${ivl}::interval` : sql`true`}
      group by 1
    )
    select
      bk.bucket at time zone 'utc' as bucket,
      coalesce(xa.cnt, 0) as count,
      coalesce(ta.vol, '0') as volume_wei,
      coalesce(ta.tr_cnt, 0) as transfers
    from buckets bk
    left join xt_agg xa on xa.bucket = bk.bucket
    left join tr_agg ta on ta.bucket = bk.bucket
    order by bk.bucket asc
  `;
  return rows.map(toActivityPoint);
}

export async function getAnalyticsRoutes(window: WindowParam): Promise<RouteVolume[]> {
  const ivl = windowInterval(window);
  const rows = await sql`
    select
      t.src_chain,
      t.dst_chain,
      count(distinct t.session)::int as count,
      count(t.id)::int as transfers,
      coalesce(sum(case when t.kind = 'eth' then t.amount else 0 end), 0)::text as value_wei
    from transfers t
    where t.safe = true
      and ${ivl !== null ? sql`t.ts >= now() - ${ivl}::interval` : sql`true`}
    group by t.src_chain, t.dst_chain
    order by sum(case when t.kind = 'eth' then t.amount else 0 end) desc
    limit 50
  `;
  return rows.map((r: any) => ({
    srcChain: Number(r.src_chain),
    dstChain: Number(r.dst_chain),
    count: Number(r.count),
    valueWei: String(r.value_wei),
    transfers: Number(r.transfers),
  }));
}

export async function getAnalyticsAssets(window: WindowParam): Promise<AssetVolume[]> {
  const ivl = windowInterval(window);
  // Native ETH is one asset network-wide; erc20 tokens are per (chain, address)
  // so same-address tokens on different rollups never merge and base units are
  // only summed within one decimals domain.
  const rows = await sql`
    select
      case when t.token is null then null else t.chain_id end as token_chain,
      t.token,
      count(t.id)::int as transfers,
      sum(t.amount)::text as amount,
      array_agg(distinct t.src_chain) as src_chains,
      array_agg(distinct t.dst_chain) as dst_chains,
      max(tk.symbol) as symbol,
      max(tk.name) as name,
      max(tk.decimals) as decimals
    from transfers t
    left join tokens tk on tk.chain_id = t.chain_id and tk.address = t.token
    where t.safe = true
      and ${ivl !== null ? sql`t.ts >= now() - ${ivl}::interval` : sql`true`}
    group by 1, 2
    order by count(t.id) desc
    limit 20
  `;

  return rows.map((r: any) => {
    const token =
      r.token != null
        ? toTokenMeta({
            chain_id: r.token_chain,
            address: r.token,
            symbol: r.symbol,
            name: r.name,
            decimals: r.decimals,
          })
        : null;
    return toAssetVolume(r, token);
  });
}

export async function getAssetActivity(
  window: WindowParam,
  interval: IntervalParam,
  token: Uint8Array | null,
): Promise<ActivityPoint[]> {
  const ivl = windowInterval(window);
  const trunc = interval === 'hour' ? 'hour' : 'day';
  const rows = await sql`
    with bounds as (
      select
        date_trunc(${trunc}, ${
          ivl !== null
            ? sql`(now() - ${ivl}::interval) at time zone 'utc'`
            : sql`coalesce((select min(ts) from transfers
                             where safe = true
                               and ${token !== null ? sql`token = ${token}` : sql`token is null`}),
                           now()) at time zone 'utc'`
        }) as start_ts,
        date_trunc(${trunc}, now() at time zone 'utc') as end_ts
    ),
    buckets as (
      select generate_series(b.start_ts, b.end_ts, ${'1 ' + trunc}::interval) as bucket
      from bounds b
    ),
    tr_agg as (
      select
        date_trunc(${trunc}, ts at time zone 'utc') as bucket,
        count(*)::int as cnt,
        sum(amount)::text as vol
      from transfers
      where safe = true
        and ${token !== null ? sql`token = ${token}` : sql`token is null`}
        and ${ivl !== null ? sql`ts >= now() - ${ivl}::interval` : sql`true`}
      group by 1
    )
    select
      bk.bucket at time zone 'utc' as bucket,
      coalesce(ta.cnt, 0) as count,
      coalesce(ta.vol, '0') as volume_wei,
      coalesce(ta.cnt, 0) as transfers
    from buckets bk
    left join tr_agg ta on ta.bucket = bk.bucket
    order by bk.bucket asc
  `;
  return rows.map(toActivityPoint);
}

export async function search(query: string): Promise<SearchResponse> {
  const q = query.trim();
  const results: SearchResponse['results'] = [];

  if (/^\d+$/.test(q)) {
    const num = Number(q);
    const sb = await getSuperblock(num);
    if (sb) results.push({ type: 'superblock', superblock: sb });
  } else if (/^0x[0-9a-fA-F]{64}$/.test(q)) {
    const buf = fromHex(q);
    // match xts by xt_hash
    const xtRows = await sql`select * from xts where xt_hash = ${buf} limit 5`;
    for (const r of xtRows) results.push({ type: 'xt', xt: toXt(r) });
    if (results.length < 10) {
      const deposits = await sql`
        select * from deposits where source_hash = ${buf} limit ${10 - results.length}`;
      for (const r of deposits) results.push({ type: 'deposit', deposit: toDeposit(r) });
    }
    if (results.length < 10) {
      const withdrawals = await sql`
        select * from withdrawals where withdrawal_hash = ${buf} limit ${10 - results.length}`;
      for (const r of withdrawals) {
        results.push({ type: 'withdrawal', withdrawal: toWithdrawal(r) });
      }
    }
    // match transfers/mailbox by tx_hash - return owning xts
    if (results.length < 10) {
      const fromTransfers = await sql`
        select distinct x.* from xts x
        join transfers t on t.session = x.xt_hash
        where t.tx_hash = ${buf}
        limit ${10 - results.length}`;
      for (const r of fromTransfers) {
        if (!results.some((res) => res.type === 'xt' && res.xt.xtHash === toHex(r.xt_hash)))
          results.push({ type: 'xt', xt: toXt(r) });
      }
    }
    if (results.length < 10) {
      const fromMailbox = await sql`
        select distinct x.* from xts x
        join mailbox_messages m on m.xt_hash = x.xt_hash
        where m.tx_hash = ${buf}
        limit ${10 - results.length}`;
      for (const r of fromMailbox) {
        if (!results.some((res) => res.type === 'xt' && res.xt.xtHash === toHex(r.xt_hash)))
          results.push({ type: 'xt', xt: toXt(r) });
      }
    }
  } else if (/^0x[0-9a-fA-F]{40}$/.test(q)) {
    const buf = fromHex(q);
    // address: count XTs plus direct bridge ops where sender/receiver matches
    const [addrCount] = await sql`
      select count(*)::int as n from xts where sender = ${buf} or receiver = ${buf}`;
    const [depositCount] = await sql`
      select count(*)::int as n from deposits where sender = ${buf} or receiver = ${buf}`;
    const [withdrawalCount] = await sql`
      select count(*)::int as n from withdrawals where sender = ${buf} or target = ${buf}`;
    const matchCount =
      Number(addrCount?.n ?? 0) +
      Number(depositCount?.n ?? 0) +
      Number(withdrawalCount?.n ?? 0);
    if (matchCount > 0) {
      results.push({ type: 'address', address: q, xtCount: matchCount });
    }
    // token match
    if (results.length < 10) {
      const tokenRows = await sql`
        select * from tokens where address = ${buf} limit ${10 - results.length}`;
      for (const r of tokenRows) results.push({ type: 'token', token: toTokenMeta(r) });
    }
  }

  return { query: q, results: results.slice(0, 10) };
}

export async function getNetwork(): Promise<NetworkView> {
  const [snapshotRow] = await sql`
    select * from publisher_snapshots order by ts desc limit 1`;
  const periodRows = await sql`
    select * from periods order by period_id desc limit 20`;
  const seriesRows = await sql`
    select * from publisher_snapshots
    where ts >= now() - interval '6 hours'
    order by ts asc limit 500`;

  return {
    publisher: snapshotRow ? toSnapshot(snapshotRow) : null,
    periods: periodRows.map(toPeriod),
    series: seriesRows.map(toSnapshot),
  };
}
