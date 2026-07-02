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
import { toInstance, toMailbox, toSuperblock, toSuperblockChain, toXt } from './mappers.ts';

const url =
  process.env.DATABASE_URL ?? 'postgres://crossscout:crossscout@localhost:5432/crossscout';

export const sql = new SQL(url);

export interface ListXtsQuery {
  status?: string;
  chain?: number;
  limit?: number;
  cursor?: string;
}

export async function listXts(p: ListXtsQuery): Promise<XtPage> {
  const limit = Math.min(Math.max(p.limit ?? 50, 1), 200);
  const status = p.status ?? null;
  const chain = p.chain ?? null;
  const cursor = p.cursor ?? null;

  const rows = await sql`
    select * from xts
    where (${status}::text is null or status = ${status})
      and (${chain}::int is null or src_chain = ${chain} or dst_chain = ${chain})
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
  return row ? toInstance(row) : null;
}

export async function getSuperblock(number: number): Promise<Superblock | null> {
  const [row] = await sql`select * from superblocks where number = ${number}`;
  if (!row) return null;
  const chainRows = await sql`
    select * from superblock_chains where superblock_number = ${number} order by chain_id`;
  return toSuperblock(row, chainRows.map(toSuperblockChain));
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
  const routeRows = await sql`
    select src_chain, dst_chain, count(*)::int as count,
           coalesce(sum(value_wei), 0)::text as value_wei
    from xts where src_chain is not null and dst_chain is not null
    group by src_chain, dst_chain order by count desc limit 20`;

  return {
    hostChain,
    totalXts: c?.total ?? 0,
    pending: c?.pending ?? 0,
    committed: c?.committed ?? 0,
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
