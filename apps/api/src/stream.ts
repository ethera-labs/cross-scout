// Live fan-out: listen on the Postgres NOTIFY channel the correlation engine
// announces row keys on, rehydrate the row into its DTO, and re-broadcast to
// every WebSocket client via Bun's native topic pub/sub. Rehydrating from
// Postgres means the stream only ever carries committed state.

import type { Server } from 'bun';
import postgres from 'postgres';
import type { StreamEvent } from '@cross-scout/sdk';
import { fromHex } from './convert.ts';
import { sql } from './db.ts';
import { toSuperblock, toSuperblockChain, toXt } from './mappers.ts';
import { enrichSuperblockFees, enrichXtUsd } from './pricing.ts';
import { STREAM_CHANNEL } from './stream_channel.ts';

export const WS_TOPIC = 'stream';

interface StreamKey {
  kind: 'newXt' | 'xtUpdated' | 'superblockUpdated';
  id: string;
}

async function rehydrate(key: StreamKey): Promise<StreamEvent | null> {
  if (key.kind === 'superblockUpdated') {
    const [row] = await sql`select * from superblocks where number = ${Number(key.id)}`;
    if (!row) return null;
    const chains =
      await sql`select * from superblock_chains where superblock_number = ${Number(key.id)} order by chain_id`;
    return {
      type: 'superblockUpdated',
      superblock: enrichSuperblockFees(toSuperblock(row, chains.map(toSuperblockChain))),
    };
  }

  const [row] = await sql`select * from xts where xt_hash = ${fromHex(key.id)}`;
  if (!row) return null;
  return { type: key.kind, xt: enrichXtUsd(toXt(row)) };
}

export function startStream(server: Server<undefined>): void {
  const url =
    process.env.DATABASE_URL ?? 'postgres://crossscout:crossscout@localhost:5432/crossscout';
  // A dedicated single-connection client: LISTEN needs a persistent session,
  // which Bun's pooled SQL client does not expose.
  const listener = postgres(url, { max: 1 });

  listener
    .listen(STREAM_CHANNEL, (payload: string) => {
      void (async () => {
        try {
          const event = await rehydrate(JSON.parse(payload) as StreamKey);
          if (event) server.publish(WS_TOPIC, JSON.stringify(event));
        } catch (e: unknown) {
          console.error('stream rehydration failed:', e);
        }
      })();
    })
    .then(() => console.log(`listening on postgres channel ${STREAM_CHANNEL}`))
    .catch((e: unknown) => console.error('postgres listen failed (live stream disabled):', e));
}
