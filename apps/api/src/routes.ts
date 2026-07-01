// REST surface (Hono): one handler per documented endpoint.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import * as db from './db.ts';

export const HOST_CHAIN = Number(process.env.HOST_CHAIN_ID ?? 8453);

const app = new Hono();
app.use('*', cors());

app.get('/', (c) =>
  c.json({
    name: 'crossscout-api',
    version: '0.1.0',
    hostChain: HOST_CHAIN,
    explorer: 'http://localhost:5173',
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

// list cross-chain txns, filtered by status, chain, period
app.get('/v1/xts', async (c) => {
  const q = c.req.query();
  const page = await db.listXts({
    status: q.status,
    chain: q.chain ? Number(q.chain) : undefined,
    period: q.period ? Number(q.period) : undefined,
    limit: q.limit ? Number(q.limit) : undefined,
    cursor: q.cursor,
  });
  return c.json(page);
});

// full XT lifecycle, votes, mailbox, block state
app.get('/v1/xts/:hash', async (c) => {
  const detail = await db.getXtDetail(c.req.param('hash'));
  return detail ? c.json(detail) : c.json({ error: 'xt not found' }, 404);
});

// SBCP instance with its 2PC votes and decision
app.get('/v1/instances/:id', async (c) => {
  const instance = await db.getInstance(c.req.param('id'));
  return instance ? c.json(instance) : c.json({ error: 'instance not found' }, 404);
});

// per-chain state transitions and validation rules
app.get('/v1/superblocks/:number', async (c) => {
  const sb = await db.getSuperblock(Number(c.req.param('number')));
  return sb ? c.json(sb) : c.json({ error: 'superblock not found' }, 404);
});

// inbox/outbox roots + message log vs a counterparty
app.get('/v1/mailbox/:chain', async (c) => c.json(await db.getMailboxView(Number(c.req.param('chain')))));

// counterparty stats + recent XTs
app.get('/v1/rollups/:chain', async (c) => c.json(await db.getRollupView(Number(c.req.param('chain')))));

// network totals and route volumes
app.get('/v1/stats', async (c) => c.json(await db.getStats(HOST_CHAIN)));

app.onError((err, c) => {
  console.error('api error:', err);
  return c.json({ error: 'internal error' }, 500);
});

export default app;
