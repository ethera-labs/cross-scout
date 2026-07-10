import type { RouteVolume, Xt } from '@cross-scout/sdk';

function field(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function download(name: string, header: string[], rows: string[][]): void {
  const body = [header, ...rows].map((row) => row.map(field).join(',')).join('\n');
  const blob = new Blob([body], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function downloadXtsCsv(xts: Xt[]): void {
  download(
    'crossscout-xts.csv',
    [
      'xt_hash',
      'src_chain',
      'dst_chain',
      'chains',
      'sender',
      'receiver',
      'label',
      'status',
      'stage',
      'value_wei',
      'superblock_number',
      'first_seen_at',
      'updated_at',
    ],
    xts.map((xt) => [
      xt.xtHash,
      String(xt.srcChain ?? ''),
      String(xt.dstChain ?? ''),
      xt.chains.join('|'),
      xt.sender ?? '',
      xt.receiver ?? '',
      xt.label ?? '',
      xt.status,
      String(xt.stage),
      xt.valueWei ?? '',
      String(xt.superblockNumber ?? ''),
      xt.firstSeenAt,
      xt.updatedAt,
    ]),
  );
}

export function downloadRoutesCsv(routes: RouteVolume[], window: string): void {
  download(
    `crossscout-routes-${window}.csv`,
    ['src_chain', 'dst_chain', 'xt_count', 'transfers', 'volume_wei'],
    routes.map((route) => [
      String(route.srcChain),
      String(route.dstChain),
      String(route.count),
      String(route.transfers),
      route.valueWei,
    ]),
  );
}
