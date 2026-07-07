import { CrossScoutClient } from '@cross-scout/sdk';

export type AnalyticsWindow = '24h' | '7d' | '30d' | 'all';

// Resolve the api origin at runtime so one build works over localhost, a LAN IP,
// or a forwarded host. VITE_API_URL overrides everything when set; otherwise
// reuse the host the explorer was served from with the api port (VITE_API_PORT).
function resolveApiBaseUrl(): string {
  const explicit = (import.meta.env.VITE_API_URL ?? '').trim();
  if (explicit) return explicit;

  const port = (import.meta.env.VITE_API_PORT ?? '').trim() || '3001';
  if (typeof window !== 'undefined' && window.location?.hostname) {
    return `${window.location.protocol}//${window.location.hostname}:${port}`;
  }
  return `http://localhost:${port}`;
}

export const apiBaseUrl: string = resolveApiBaseUrl();

export const api = new CrossScoutClient(apiBaseUrl);
