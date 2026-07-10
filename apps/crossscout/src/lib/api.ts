import { CrossScoutClient } from '@cross-scout/sdk';

export type AnalyticsWindow = '24h' | '7d' | '30d' | 'all';

// Resolve the api origin at runtime so one build works over localhost, a LAN IP,
// or a forwarded host. VITE_API_URL overrides everything when set. Otherwise, if
// VITE_API_PORT is set the api runs on a different port than the explorer (e.g.
// local dev); reuse the served host with that port. With neither set, the api
// serves the explorer itself, so the same origin the page loaded from is correct.
function resolveApiBaseUrl(): string {
  const explicit = (import.meta.env.VITE_API_URL ?? '').trim();
  if (explicit) return explicit;

  const port = (import.meta.env.VITE_API_PORT ?? '').trim();
  if (port && typeof window !== 'undefined' && window.location?.hostname) {
    return `${window.location.protocol}//${window.location.hostname}:${port}`;
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return 'http://localhost:3001';
}

export const apiBaseUrl: string = resolveApiBaseUrl();

export const api = new CrossScoutClient(apiBaseUrl);
