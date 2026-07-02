import { useEffect, useState } from 'react';
import { CheckIcon, CopyIcon } from './icons';

function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
  // Non-secure contexts (plain-http LAN hosts) have no clipboard API.
  const area = document.createElement('textarea');
  area.value = value;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  document.execCommand('copy');
  document.body.removeChild(area);
  return Promise.resolve();
}

/**
 * Copy-to-clipboard affordance. A `span` rather than a `button` so it can sit
 * inside clickable table rows without invalid nesting; clicks never bubble to
 * the row.
 */
export function CopyButton({ value }: { value: string | null | undefined }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1200);
    return () => window.clearTimeout(id);
  }, [copied]);

  if (!value) return null;
  return (
    <span
      role="button"
      title="Copy"
      aria-label={`Copy ${value}`}
      className={copied ? 'copy-button copied' : 'copy-button'}
      onClick={(event) => {
        event.stopPropagation();
        void copyText(value)
          .then(() => setCopied(true))
          .catch(() => undefined);
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </span>
  );
}
