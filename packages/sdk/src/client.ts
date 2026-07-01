// Typed REST + WebSocket client for the CrossScout api. Works in the browser
// and under Bun (both provide `fetch` and `WebSocket` globals).

import type {
  Instance,
  MailboxView,
  NetworkStats,
  RollupView,
  StreamEvent,
  Superblock,
  XtDetail,
  XtPage,
} from './types';

export interface ListXtsParams {
  status?: string;
  chain?: number;
  period?: number;
  limit?: number;
  cursor?: string;
}

export class CrossScoutClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  private async get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    const url = new URL(this.baseUrl + path);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`crossscout ${res.status} ${res.statusText} for ${path}`);
    return (await res.json()) as T;
  }

  listXts(params: ListXtsParams = {}): Promise<XtPage> {
    return this.get<XtPage>('/v1/xts', params as Record<string, unknown>);
  }

  getXt(hash: string): Promise<XtDetail> {
    return this.get<XtDetail>(`/v1/xts/${hash}`);
  }

  getInstance(id: string): Promise<Instance> {
    return this.get<Instance>(`/v1/instances/${id}`);
  }

  getSuperblock(number: number): Promise<Superblock> {
    return this.get<Superblock>(`/v1/superblocks/${number}`);
  }

  getMailbox(chain: number): Promise<MailboxView> {
    return this.get<MailboxView>(`/v1/mailbox/${chain}`);
  }

  getRollup(chain: number): Promise<RollupView> {
    return this.get<RollupView>(`/v1/rollups/${chain}`);
  }

  getStats(): Promise<NetworkStats> {
    return this.get<NetworkStats>('/v1/stats');
  }

  /** Open the live stream. Returns a handle you can `.close()`. */
  stream(onEvent: (ev: StreamEvent) => void, onStatus?: (up: boolean) => void): CrossScoutStream {
    const wsUrl = this.baseUrl.replace(/^http/, 'ws') + '/v1/stream';
    return new CrossScoutStream(wsUrl, onEvent, onStatus);
  }
}

/** Auto-reconnecting WebSocket wrapper over `/v1/stream`. */
export class CrossScoutStream {
  private ws?: WebSocket;
  private closed = false;
  private retry = 0;

  constructor(
    private readonly url: string,
    private readonly onEvent: (ev: StreamEvent) => void,
    private readonly onStatus?: (up: boolean) => void,
  ) {
    this.connect();
  }

  private connect(): void {
    if (this.closed) return;
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.retry = 0;
      this.onStatus?.(true);
    };
    ws.onmessage = (e: MessageEvent) => {
      try {
        this.onEvent(JSON.parse(String(e.data)) as StreamEvent);
      } catch {
        /* ignore malformed frame */
      }
    };
    ws.onclose = () => {
      this.onStatus?.(false);
      if (this.closed) return;
      const delay = Math.min(1000 * 2 ** this.retry++, 15_000);
      setTimeout(() => this.connect(), delay);
    };
    ws.onerror = () => ws.close();
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
  }
}
