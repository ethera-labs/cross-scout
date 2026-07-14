import { chainName, shortHex } from './format';

export type Theme = 'dark' | 'light';

export type Page =
  | 'overview'
  | 'txs'
  | 'txDetail'
  | 'bridge'
  | 'superblocks'
  | 'superblockDetail'
  | 'mailbox'
  | 'rollups'
  | 'rollupDetail'
  | 'network';

/** Parsed location: which page plus the entity it points at. */
export interface Route {
  page: Page;
  txHash?: string;
  superblock?: number;
  chain?: number;
}

/** Hash for a route; detail pages carry their entity in the path. */
export function routeHash(route: Route): string {
  switch (route.page) {
    case 'overview':
      return '#/';
    case 'txDetail':
      return `#/tx/${route.txHash ?? ''}`;
    case 'superblockDetail':
      return `#/superblock/${route.superblock ?? ''}`;
    case 'rollupDetail':
      return `#/rollup/${route.chain ?? ''}`;
    case 'mailbox':
      return route.chain != null ? `#/mailbox/${route.chain}` : '#/mailbox';
    default:
      return `#/${route.page}`;
  }
}

/** Parse a location hash; anything unrecognized lands on the overview. */
export function parseHash(hash: string): Route {
  const [head, arg] = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  switch (head) {
    case undefined:
      return { page: 'overview' };
    case 'txs':
      return { page: 'txs' };
    case 'tx':
      return arg ? { page: 'txDetail', txHash: arg } : { page: 'txs' };
    case 'bridge':
      return { page: 'bridge' };
    case 'superblocks':
      return { page: 'superblocks' };
    case 'superblock': {
      const number = Number(arg);
      return Number.isFinite(number)
        ? { page: 'superblockDetail', superblock: number }
        : { page: 'superblocks' };
    }
    case 'mailbox': {
      const chain = Number(arg);
      return arg != null && Number.isFinite(chain) ? { page: 'mailbox', chain } : { page: 'mailbox' };
    }
    case 'rollups':
      return { page: 'rollups' };
    case 'rollup': {
      const chain = Number(arg);
      return Number.isFinite(chain) ? { page: 'rollupDetail', chain } : { page: 'rollups' };
    }
    case 'network':
      return { page: 'network' };
    default:
      return { page: 'overview' };
  }
}

/** Href helpers so nav and list rows render as real links. */
export function pageHref(page: Page): string {
  return routeHash({ page });
}
export function txHref(hash: string): string {
  return `#/tx/${hash}`;
}
export function superblockHref(number: number): string {
  return `#/superblock/${number}`;
}
export function rollupHref(chain: number): string {
  return `#/rollup/${chain}`;
}
export function mailboxHref(chain: number): string {
  return `#/mailbox/${chain}`;
}

const PAGE_TITLES: Record<Page, string> = {
  overview: 'network overview',
  txs: 'transactions',
  txDetail: 'transaction',
  bridge: 'bridge',
  superblocks: 'superblocks',
  superblockDetail: 'superblock',
  mailbox: 'mailbox',
  rollups: 'rollups',
  rollupDetail: 'rollup',
  network: 'publisher',
};

/** Document title for a route, entity-specific on detail pages. */
export function routeTitle(route: Route): string {
  if (route.page === 'txDetail' && route.txHash) {
    return `CrossScout - tx ${shortHex(route.txHash, 6, 4)}`;
  }
  if (route.page === 'superblockDetail' && route.superblock != null) {
    return `CrossScout - superblock #${route.superblock}`;
  }
  if (route.page === 'rollupDetail' && route.chain != null) {
    return `CrossScout - ${chainName(route.chain)}`;
  }
  return `CrossScout - ${PAGE_TITLES[route.page]}`;
}
