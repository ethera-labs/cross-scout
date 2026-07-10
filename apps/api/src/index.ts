// CrossScout server - Bun serves the REST + WebSocket api (Hono) and the
// built explorer SPA from a single port.

import app, { HOST_CHAIN } from './routes.ts';
import { serveStatic } from './static.ts';
import { startStream, WS_TOPIC } from './stream.ts';

const port = Number(process.env.API_PORT ?? 3001);
const hostname = process.env.API_HOST ?? '0.0.0.0';

function isApiPath(pathname: string): boolean {
  return pathname === '/health' || pathname === '/ready' || pathname === '/v1' ||
    pathname.startsWith('/v1/');
}

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
    if (isApiPath(url.pathname)) return app.fetch(req, { server: srv });
    return serveStatic(req);
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
  `crossscout → http://${hostname}:${port}  (host chain ${HOST_CHAIN}, api /v1, ws /v1/stream)`,
);
