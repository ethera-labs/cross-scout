// Serves the built explorer SPA. Resolved relative to this file so it works
// regardless of the process cwd.

import { join, normalize, resolve, sep } from 'node:path';

const DIST_DIR = resolve(import.meta.dir, '../../crossscout/dist');
const INDEX_HTML = join(DIST_DIR, 'index.html');

const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
const SHORT_CACHE = 'public, max-age=300';
const NO_CACHE = 'no-cache';

// Resolves a URL pathname to a file inside DIST_DIR, rejecting traversal
// outside of it (normalized path must still start with DIST_DIR).
function resolveDistPath(pathname: string): string | undefined {
  const decoded = decodeURIComponent(pathname);
  const candidate = normalize(join(DIST_DIR, decoded));
  if (candidate !== DIST_DIR && !candidate.startsWith(DIST_DIR + sep)) return undefined;
  return candidate;
}

export async function serveStatic(req: Request): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response('method not allowed', { status: 405 });
  }

  const indexFile = Bun.file(INDEX_HTML);
  if (!(await indexFile.exists())) {
    return new Response('explorer build not found - run `bun run --cwd apps/crossscout build`\n', {
      status: 404,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  const { pathname } = new URL(req.url);
  const path = resolveDistPath(pathname);
  const file = path ? Bun.file(path) : undefined;

  if (file && (await file.exists()) && path !== DIST_DIR) {
    const cache = pathname.startsWith('/assets/') ? IMMUTABLE_CACHE : SHORT_CACHE;
    return new Response(req.method === 'HEAD' ? undefined : file, {
      headers: { 'Cache-Control': cache },
    });
  }

  // Unknown path: hand off to the SPA router.
  return new Response(req.method === 'HEAD' ? undefined : indexFile, {
    headers: { 'Cache-Control': NO_CACHE },
  });
}
