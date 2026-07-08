import { useState } from 'react';
import type { TokenMeta } from '@cross-scout/sdk';
import { tokenLogoUrl } from '../lib/tokens';
import { Button } from '../ui/Button';

declare global {
  interface Window {
    ethereum?: {
      request(args: { method: string; params?: unknown }): Promise<unknown>;
    };
  }
}

function EthMark({ size }: { size: number }) {
  return (
    <svg className="token-logo" style={{ width: size, height: size }} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="16" fill="#627eea" />
      <g fill="#fff">
        <path fillOpacity="0.602" d="M16.498 4v8.87l7.497 3.35z" />
        <path d="M16.498 4L9 16.22l7.498-3.35z" />
        <path fillOpacity="0.602" d="M16.498 21.968v6.027L24 17.616z" />
        <path d="M16.498 27.995v-6.028L9 17.616z" />
        <path fillOpacity="0.2" d="M16.498 20.573l7.497-4.353-7.497-3.348z" />
        <path fillOpacity="0.602" d="M9 16.22l7.498 4.353v-7.701z" />
      </g>
    </svg>
  );
}

/** Native ETH shows the Ethereum mark; ERC-20s show the remote logo, or symbol
 *  initials when it is unset or unreachable. */
export function AssetIcon({
  token,
  native,
  size = 30,
}: {
  token: TokenMeta | null;
  native: boolean;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  if (native) return <EthMark size={size} />;

  const url = tokenLogoUrl(token);
  if (url && !failed) {
    return (
      <img
        className="token-logo"
        style={{ width: size, height: size }}
        src={url}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <span className="token-logo token-logo-fallback" style={{ width: size, height: size }}>
      {(token?.symbol ?? '?').slice(0, 3).toUpperCase()}
    </span>
  );
}

async function watchAsset(token: TokenMeta): Promise<void> {
  const provider = window.ethereum;
  if (!provider?.request) return;
  await provider.request({
    method: 'wallet_watchAsset',
    params: {
      type: 'ERC20',
      options: {
        address: token.address,
        symbol: (token.symbol ?? 'TOKEN').slice(0, 11),
        decimals: token.decimals ?? 18,
        image: tokenLogoUrl(token) ?? undefined,
      },
    },
  });
}

export function AddTokenButton({ token }: { token: TokenMeta | null }) {
  if (!token) return null;
  const available = typeof window !== 'undefined' && Boolean(window.ethereum?.request);
  return (
    <Button
      variant="subtle"
      size="sm"
      className="add-token-button"
      disabled={!available}
      onClick={() => void watchAsset(token)}
    >
      Add to MetaMask
    </Button>
  );
}
