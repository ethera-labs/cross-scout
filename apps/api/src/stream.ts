// Live fan-out: subscribe to the Redis channel the correlation engine publishes
// on, and re-broadcast each delta to every WebSocket client via Bun's native
// topic pub/sub.

import { RedisClient } from 'bun';
import type { Server } from 'bun';
import { STREAM_CHANNEL } from './stream_channel.ts';

export const WS_TOPIC = 'stream';

export function startStream(server: Server<undefined>): void {
  const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
  const sub = new RedisClient(url);

  sub
    .subscribe(STREAM_CHANNEL, (message: string) => {
      // message is the JSON StreamEvent produced by cross-scout-store.
      server.publish(WS_TOPIC, message);
    })
    .then(() => console.log(`subscribed to redis channel ${STREAM_CHANNEL}`))
    .catch((e: unknown) => console.error('redis subscribe failed (live stream disabled):', e));
}
