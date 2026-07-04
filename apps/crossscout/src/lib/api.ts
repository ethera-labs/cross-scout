import { CrossScoutClient } from '@cross-scout/sdk';

export type AnalyticsWindow = '24h' | '7d' | '30d' | 'all';

export const apiBaseUrl: string = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

export const api = new CrossScoutClient(apiBaseUrl);
