import type { TokenMeta, Transfer } from '@cross-scout/sdk';
import { formatEthCompact, formatTokenAmount, shortHex, withUsd } from './format';

// ERC-20 logo URL template with {chainId}/{address} placeholders, injected via
// env. Empty leaves rows on a generated glyph instead of a remote image.
const logoTemplate = (import.meta.env.VITE_ASSET_LOGO_URL_TEMPLATE ?? '').trim();

/** Resolve a transfer's token metadata, preferring an exact chain match. */
export function tokenFor(transfer: Transfer, tokens: TokenMeta[]): TokenMeta | null {
  if (!transfer.token) return null;
  const address = transfer.token.toLowerCase();
  return (
    tokens.find((token) => token.address.toLowerCase() === address && token.chainId === transfer.chainId) ??
    tokens.find((token) => token.address.toLowerCase() === address) ??
    null
  );
}

export function tokenSymbol(transfer: Transfer, tokens: TokenMeta[]): string {
  if (transfer.kind === 'eth') return 'ETH';
  return tokenFor(transfer, tokens)?.symbol ?? shortHex(transfer.token, 5, 3);
}

export function tokenLogoUrl(token: TokenMeta | null): string | null {
  if (!token || !logoTemplate) return null;
  return logoTemplate
    .replaceAll('{chainId}', String(token.chainId))
    .replaceAll('{address}', token.address.toLowerCase());
}

/** Human-readable transfer amount with a USD suffix when priced. */
export function transferAmount(transfer: Transfer, tokens: TokenMeta[]): string {
  if (transfer.kind === 'eth') return withUsd(formatEthCompact(transfer.amount), transfer.amountUsd);
  const meta = tokenFor(transfer, tokens);
  const symbol = meta?.symbol ?? shortHex(transfer.token, 5, 3);
  return withUsd(formatTokenAmount(transfer.amount, meta?.decimals, symbol), transfer.amountUsd);
}
