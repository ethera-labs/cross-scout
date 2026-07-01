import { CrossScoutClient } from '@cross-scout/sdk';

const baseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

export const api = new CrossScoutClient(baseUrl);
