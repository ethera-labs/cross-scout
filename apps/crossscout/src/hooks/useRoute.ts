import { useMemo, useSyncExternalStore } from 'react';
import type { Route } from '../lib/nav';
import { parseHash, routeHash } from '../lib/nav';

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

function readHash(): string {
  return window.location.hash;
}

function navigate(next: Route): void {
  const target = routeHash(next);
  if (window.location.hash !== target) window.location.hash = target;
}

/**
 * Route state derived from location.hash. Writing the hash pushes a history
 * entry, so back/forward and deep links work; the hashchange subscription is
 * the single place state updates.
 */
export function useRoute() {
  const hash = useSyncExternalStore(subscribe, readHash);
  const route = useMemo(() => parseHash(hash), [hash]);
  return { route, navigate };
}
