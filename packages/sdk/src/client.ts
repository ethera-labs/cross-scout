// Typed REST + WebSocket client for the CrossScout api. Works in the browser
// and under Bun (both provide `fetch` and `WebSocket` globals).

import type {
  ActivityPoint,
  AssetVolume,
  Deposit,
  DepositPage,
  Instance,
  MailboxView,
  NetworkStats,
  NetworkView,
  RollupView,
  RouteVolume,
  SearchResponse,
  StreamEvent,
  Superblock,
  SuperblockPage,
  SuperblockStatus,
  Withdrawal,
  WithdrawalPage,
  XtDetail,
  XtPage,
  XtStatus,
} from './types';

export interface ListXtsParams {
  status?: XtStatus;
  chain?: number;
  limit?: number;
  cursor?: string;
  address?: string;
  token?: string;
}

export interface ListBridgeOpsParams {
  status?: string;
  chain?: number;
  limit?: number;
  cursor?: string;
  address?: string;
}

export interface ListSuperblocksParams {
  limit?: number;
  cursor?: number;
  status?: SuperblockStatus;
}

export interface ActivityParams {
  window?: string;
  interval?: 'hour' | 'day';
}

export interface AssetActivityParams {
  window?: string;
  interval?: 'hour' | 'day';
  token?: string;
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

  listDeposits(params: ListBridgeOpsParams = {}): Promise<DepositPage> {
    return this.get<DepositPage>('/v1/deposits', params as Record<string, unknown>);
  }

  getDeposit(sourceHash: string): Promise<Deposit> {
    return this.get<Deposit>(`/v1/deposits/${sourceHash}`);
  }

  listWithdrawals(params: ListBridgeOpsParams = {}): Promise<WithdrawalPage> {
    return this.get<WithdrawalPage>('/v1/withdrawals', params as Record<string, unknown>);
  }

  getWithdrawal(withdrawalHash: string): Promise<Withdrawal> {
    return this.get<Withdrawal>(`/v1/withdrawals/${withdrawalHash}`);
  }

  getInstance(id: string): Promise<Instance> {
    return this.get<Instance>(`/v1/instances/${id}`);
  }

  listSuperblocks(params: ListSuperblocksParams = {}): Promise<SuperblockPage> {
    return this.get<SuperblockPage>('/v1/superblocks', params as Record<string, unknown>);
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

  getActivity(params: ActivityParams = {}): Promise<ActivityPoint[]> {
    return this.get<ActivityPoint[]>('/v1/analytics/activity', params as Record<string, unknown>);
  }

  getRoutes(window?: string): Promise<RouteVolume[]> {
    return this.get<RouteVolume[]>('/v1/analytics/routes', window ? { window } : undefined);
  }

  getAssets(window?: string): Promise<AssetVolume[]> {
    return this.get<AssetVolume[]>('/v1/analytics/assets', window ? { window } : undefined);
  }

  getAssetActivity(params: AssetActivityParams = {}): Promise<ActivityPoint[]> {
    return this.get<ActivityPoint[]>(
      '/v1/analytics/assets/activity',
      params as Record<string, unknown>,
    );
  }

  search(q: string): Promise<SearchResponse> {
    return this.get<SearchResponse>('/v1/search', { q });
  }

  getNetwork(): Promise<NetworkView> {
    return this.get<NetworkView>('/v1/network');
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
