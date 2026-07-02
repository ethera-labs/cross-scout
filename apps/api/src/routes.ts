// REST surface (Hono): one handler per documented endpoint.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import * as db from './db.ts';

export const HOST_CHAIN = Number(process.env.HOST_CHAIN_ID ?? 0);

/** Strictly numeric param; `undefined` when absent or not a safe integer. */
function intParam(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : undefined;
}

const app = new Hono();
app.use('*', cors());

app.get('/', (c) =>
  c.json({
    name: 'crossscout-api',
    version: '0.1.0',
    hostChain: HOST_CHAIN,
    explorer: process.env.EXPLORER_URL ?? null,
    endpoints: [
      'GET /health',
      'GET /v1/xts',
      'GET /v1/xts/:hash',
      'GET /v1/instances/:id',
      'GET /v1/superblocks/:number',
      'GET /v1/mailbox/:chain',
      'GET /v1/rollups/:chain',
      'GET /v1/stats',
      'WS  /v1/stream',
    ],
  }),
);

app.get('/health', (c) => c.json({ ok: true, hostChain: HOST_CHAIN }));

// list cross-chain txns, filtered by status, chain
app.get('/v1/xts', async (c) => {
  const q = c.req.query();
  const chain = intParam(q.chain);
  const limit = intParam(q.limit);
  if (q.chain && chain === undefined) return c.json({ error: 'invalid chain' }, 400);
  if (q.limit && limit === undefined) return c.json({ error: 'invalid limit' }, 400);
  if (q.cursor && Number.isNaN(Date.parse(q.cursor))) {
    return c.json({ error: 'invalid cursor' }, 400);
  }
  const page = await db.listXts({ status: q.status, chain, limit, cursor: q.cursor });
  return c.json(page);
});

// full XT lifecycle, session, mailbox, superblock
app.get('/v1/xts/:hash', async (c) => {
  const detail = await db.getXtDetail(c.req.param('hash'));
  return detail ? c.json(detail) : c.json({ error: 'xt not found' }, 404);
});

// cross-chain session and its derived decision
app.get('/v1/instances/:id', async (c) => {
  const instance = await db.getInstance(c.req.param('id'));
  return instance ? c.json(instance) : c.json({ error: 'instance not found' }, 404);
});

// recent superblocks with their per-chain transitions
app.get('/v1/superblocks', async (c) => {
  const raw = c.req.query('limit');
  const limit = intParam(raw);
  if (raw && limit === undefined) return c.json({ error: 'invalid limit' }, 400);
  return c.json(await db.listSuperblocks(limit));
});

// per-chain state transitions and validation rules
app.get('/v1/superblocks/:number', async (c) => {
  const number = intParam(c.req.param('number'));
  if (number === undefined) return c.json({ error: 'invalid superblock number' }, 400);
  const sb = await db.getSuperblock(number);
  return sb ? c.json(sb) : c.json({ error: 'superblock not found' }, 404);
});

// inbox/outbox roots + message log vs a counterparty
app.get('/v1/mailbox/:chain', async (c) => {
  const chain = intParam(c.req.param('chain'));
  if (chain === undefined) return c.json({ error: 'invalid chain' }, 400);
  return c.json(await db.getMailboxView(chain));
});

// counterparty stats + recent XTs
app.get('/v1/rollups/:chain', async (c) => {
  const chain = intParam(c.req.param('chain'));
  if (chain === undefined) return c.json({ error: 'invalid chain' }, 400);
  return c.json(await db.getRollupView(chain));
});

// network totals and route volumes
app.get('/v1/stats', async (c) => c.json(await db.getStats(HOST_CHAIN)));

app.onError((err, c) => {
  console.error('api error:', err);
  return c.json({ error: 'internal error' }, 500);
});

export default app;
