import { useState } from 'react';
import type { TokenMeta, Transfer } from '@cross-scout/sdk';
import { tokenFor, tokenLogoUrl, tokenSymbol } from '../lib/tokens';
import { Button } from '../ui/Button';

declare global {
  interface Window {
    ethereum?: {
      request(args: { method: string; params?: unknown }): Promise<unknown>;
    };
  }
}

/** Token glyph: the remote logo when configured and reachable, initials otherwise. */
export function TokenLogo({ transfer, tokens }: { transfer: Transfer; tokens: TokenMeta[] }) {
  const [failed, setFailed] = useState(false);
  const url = transfer.kind === 'erc20' ? tokenLogoUrl(tokenFor(transfer, tokens)) : null;

  if (url && !failed) {
    return (
      <img
        className="token-logo"
        src={url}
        alt=""
        width={30}
        height={30}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  }

  return <span className="token-logo token-logo-fallback">{tokenSymbol(transfer, tokens).slice(0, 3).toUpperCase()}</span>;
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
