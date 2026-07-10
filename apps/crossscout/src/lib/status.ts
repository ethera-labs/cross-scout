import type { SuperblockStatus, XtStatus } from '@cross-scout/sdk';

export type XtFilter = XtStatus | 'all';
export type SuperblockFilter = SuperblockStatus | 'all';

export const xtFilters: XtFilter[] = [
  'all',
  'pending',
  'committed',
  'validated',
  'finalized',
  'failed',
];
export const superblockFilters: SuperblockFilter[] = ['all', 'proposed', 'validated', 'finalized'];

export const xtLabels: Record<XtFilter, string> = {
  all: 'All',
  pending: 'In-flight',
  committed: 'Committed',
  validated: 'Validated',
  finalized: 'Finalized',
  failed: 'Rolled back',
};

export const superblockLabels: Record<SuperblockFilter, string> = {
  all: 'All',
  proposed: 'Proposed',
  validated: 'Validated',
  finalized: 'Finalized',
};

export const statusVar: Record<XtStatus | SuperblockStatus, string> = {
  pending: 'var(--accent)',
  committed: 'var(--warn)',
  proposed: 'var(--warn)',
  validated: 'var(--info)',
  finalized: 'var(--ok)',
  failed: 'var(--bad)',
};

export const statusSoft: Record<XtStatus | SuperblockStatus, string> = {
  pending: 'var(--accent-soft)',
  committed: 'var(--warn-soft)',
  proposed: 'var(--warn-soft)',
  validated: 'var(--info-soft)',
  finalized: 'var(--ok-soft)',
  failed: 'var(--bad-soft)',
};

export function statusLabel(status: XtStatus | SuperblockStatus): string {
  switch (status) {
    case 'pending':
      return 'In-flight';
    case 'committed':
      return 'Committed';
    case 'failed':
      return 'Rolled back';
    default:
      return status.slice(0, 1).toUpperCase() + status.slice(1);
  }
}
