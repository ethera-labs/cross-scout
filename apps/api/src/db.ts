// Postgres access via Bun's built-in SQL client. Each function returns SDK
// DTOs, mapped from snake_case rows. Filters use null-guarded predicates so one
// parameterized query covers the optional-filter cases.

import { SQL } from 'bun';
import type {
  Instance,
  MailboxView,
  NetworkStats,
  RollupView,
  Superblock,
  XtDetail,
  XtPage,
} from '@cross-scout/sdk';
import { fromHex, toHex, toIso } from './hex.ts';
import {
  toInstance,
  toMailbox,
  toSuperblock,
  toSuperblockChain,
  toVote,
  toXt,
} from './mappers.ts';

const url =
  process.env.DATABASE_URL ?? 'postgres://crossscout:crossscout@localhost:5432/crossscout';

export const sql = new SQL(url);

export interface ListXtsQuery {
  status?: string;
  chain?: number;
  period?: number;
  limit?: number;
  cursor?: string;
}

export async function listXts(p: ListXtsQuery): Promise<XtPage> {
  const limit = Math.min(Math.max(p.limit ?? 50, 1), 200);
  const status = p.status ?? null;
  const chain = p.chain ?? null;
  const period = p.period ?? null;
  const cursor = p.cursor ?? null;

  const rows = await sql`
    select * from xts
    where (${status}::text is null or status = ${status})
      and (${chain}::int is null or src_chain = ${chain} or dst_chain = ${chain})
      and (${period}::bigint is null or period = ${period})
      and (${cursor}::timestamptz is null or updated_at < ${cursor}::timestamptz)
    order by updated_at desc
    limit ${limit}
  `;

  const last = rows[rows.length - 1];
  const nextCursor = rows.length === limit && last ? toIso(last.updated_at) : null;
  return { items: rows.map(toXt), nextCursor };
}

export async function getInstance(idHex: string): Promise<Instance | null> {
  const buf = fromHex(idHex);
  const [row] = await sql`select * from instances where instance_id = ${buf}`;
  if (!row) return null;
  const voteRows = await sql`select * from votes where instance_id = ${buf} order by chain_id`;
  return toInstance(row, voteRows.map(toVote));
}

export async function getSuperblock(number: number): Promise<Superblock | null> {
  const [row] = await sql`select * from superblocks where number = ${number}`;
  if (!row) return null;
  const chainRows = await sql`
    select * from superblock_chains where superblock_number = ${number} order by chain_id`;
  return toSuperblock(row, chainRows.map(toSuperblockChain));
}

export async function getXtDetail(hashHex: string): Promise<XtDetail | null> {
  const buf = fromHex(hashHex);
  const [xtRow] = await sql`select * from xts where xt_hash = ${buf}`;
  if (!xtRow) return null;

  const xt = toXt(xtRow);
  const instance = await getInstance(toHex(xtRow.instance_id)!);
  const mbRows = await sql`select * from mailbox_messages where xt_hash = ${buf} order by ts`;
  const superblock =
    xtRow.superblock_number != null ? await getSuperblock(Number(xtRow.superblock_number)) : null;

  return { xt, instance, mailbox: mbRows.map(toMailbox), superblock };
}

export async function getMailboxView(chain: number): Promise<MailboxView> {
  const rows = await sql`
    select * from mailbox_messages
    where chain_id = ${chain} or src_chain = ${chain} or dst_chain = ${chain}
    order by ts desc limit 100`;

  const [ob] = await sql`
    select payload from raw_events
    where kind = 'outbox_root_updated' and chain_id = ${chain}
    order by block_number desc limit 1`;
  const [ib] = await sql`
    select payload from raw_events
    where kind = 'inbox_root_updated' and chain_id = ${chain}
    order by block_number desc limit 1`;

  return {
    chainId: chain,
    outboxRoot: ob?.payload?.root ?? null,
    inboxRoot: ib?.payload?.root ?? null,
    messages: rows.map(toMailbox),
  };
}

export async function getRollupView(chain: number): Promise<RollupView> {
  const [counts] = await sql`
    select
      count(*)::int as xt_count,
      count(*) filter (where status = 'finalized')::int as finalized,
      count(*) filter (where status in ('pending','unsafe'))::int as pending
    from xts where src_chain = ${chain} or dst_chain = ${chain}`;
  const recent = await sql`
    select * from xts where src_chain = ${chain} or dst_chain = ${chain}
    order by updated_at desc limit 10`;

  return {
    chainId: chain,
    xtCount: counts?.xt_count ?? 0,
    finalized: counts?.finalized ?? 0,
    pending: counts?.pending ?? 0,
    recentXts: recent.map(toXt),
  };
}

export async function getStats(hostChain: number): Promise<NetworkStats> {
  const [c] = await sql`
    select
      count(*)::int as total,
      count(*) filter (where status in ('pending','unsafe'))::int as pending,
      count(*) filter (where status = 'validated')::int as validated,
      count(*) filter (where status = 'finalized')::int as finalized,
      count(*) filter (where status = 'failed')::int as failed
    from xts`;
  const [sb] = await sql`select count(*)::int as n, avg(prove_ms)::float as avg from superblocks`;
  const routeRows = await sql`
    select src_chain, dst_chain, count(*)::int as count,
           coalesce(sum(value_wei), 0)::text as value_wei
    from xts where src_chain is not null and dst_chain is not null
    group by src_chain, dst_chain order by count desc limit 20`;

  return {
    hostChain,
    totalXts: c?.total ?? 0,
    pending: c?.pending ?? 0,
    validated: c?.validated ?? 0,
    finalized: c?.finalized ?? 0,
    failed: c?.failed ?? 0,
    superblocks: sb?.n ?? 0,
    avgProveMs: sb?.avg ?? null,
    routes: routeRows.map((r: any) => ({
      srcChain: Number(r.src_chain),
      dstChain: Number(r.dst_chain),
      count: Number(r.count),
      valueWei: String(r.value_wei),
    })),
  };
}
