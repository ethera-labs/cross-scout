import type { RouteVolume } from '@cross-scout/sdk';

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
