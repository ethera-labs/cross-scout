import { Button } from '../ui/Button';

export function CursorPagination({
  ariaLabel,
  page,
  loading,
  hasNewer,
  hasOlder,
  onNewer,
  onOlder,
}: {
  ariaLabel: string;
  page: number;
  loading: boolean;
  hasNewer: boolean;
  hasOlder: boolean;
  onNewer: () => void;
  onOlder: () => void;
}) {
  return (
    <nav className="pager" aria-label={ariaLabel}>
      <Button variant="subtle" size="sm" disabled={!hasNewer || loading} onClick={onNewer}>
        &lt;- Newer
      </Button>
      <span className="mono">Page {page}</span>
      <Button variant="subtle" size="sm" disabled={!hasOlder || loading} onClick={onOlder}>
        Older -&gt;
      </Button>
    </nav>
  );
}
