import type { Xt } from '@cross-scout/sdk';

const COLUMNS = [
  'xt_hash',
  'instance_id',
  'src_chain',
  'dst_chain',
  'chains',
  'status',
  'stage',
  'value_wei',
  'superblock_number',
  'first_seen_at',
  'updated_at',
];

export function downloadXtsCsv(xts: Xt[]): void {
  const rows = xts.map((xt) =>
    [
      xt.xtHash,
      xt.instanceId,
      xt.srcChain ?? '',
      xt.dstChain ?? '',
      xt.chains.join('|'),
      xt.status,
      xt.stage,
      xt.valueWei ?? '',
      xt.superblockNumber ?? '',
      xt.firstSeenAt,
      xt.updatedAt,
    ].join(','),
  );
  const blob = new Blob([[COLUMNS.join(','), ...rows].join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'crossscout-xts.csv';
  link.click();
  URL.revokeObjectURL(url);
}
