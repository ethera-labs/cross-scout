// CrossScout api - Bun server: Hono for REST, native Bun WebSocket for the
// live stream at /v1/stream.

import app, { HOST_CHAIN } from './routes.ts';
import { startStream, WS_TOPIC } from './stream.ts';

const port = Number(process.env.API_PORT ?? 3001);
const hostname = process.env.API_HOST ?? '0.0.0.0';

const server = Bun.serve({
  port,
  hostname,
  fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname === '/v1/stream') {
      // hand the socket to Bun's websocket handler below
      if (srv.upgrade(req)) return undefined;
      return new Response('expected websocket upgrade', { status: 426 });
    }
    return app.fetch(req, { server: srv });
  },
  websocket: {
    open(ws) {
      ws.subscribe(WS_TOPIC);
    },
    close(ws) {
      ws.unsubscribe(WS_TOPIC);
    },
    message() {
      // stream is receive-only; ignore anything a client sends
    },
  },
});

startStream(server);

console.log(
  `crossscout api → http://${hostname}:${port}  (host chain ${HOST_CHAIN}, ws /v1/stream)`,
);
