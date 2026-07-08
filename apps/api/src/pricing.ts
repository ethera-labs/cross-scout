import { formatUnits } from 'viem';
import type { MailboxMessage, Superblock, TokenMeta, Transfer, TxFee, Xt } from '@cross-scout/sdk';

type PriceLookup = Map<string, number>;

const prices: PriceLookup = parsePrices(process.env.TOKEN_USD_PRICES ?? '');

function parsePrices(raw: string): PriceLookup {
  const out = new Map<string, number>();
  for (const entry of raw.split(',')) {
    const [keyRaw, valueRaw] = entry.split('=');
    const key = normalizeKey(keyRaw);
    const value = Number(valueRaw);
    if (key && Number.isFinite(value) && value >= 0) out.set(key, value);
  }
  return out;
}

function normalizeKey(key: string | undefined): string | null {
  const trimmed = key?.trim();
  if (!trimmed) return null;
  const [maybeChain, maybeAddress] = trimmed.split(':');
  if (maybeAddress) return `${maybeChain}:${maybeAddress.toLowerCase()}`;
  return trimmed.startsWith('0x') ? trimmed.toLowerCase() : trimmed.toUpperCase();
}

function nativePrice(): number | null {
  return prices.get('ETH') ?? null;
}

function tokenPrice(
  chainId: number,
  addressRaw: string | null | undefined,
  symbol: string | null | undefined,
): number | null {
  if (!addressRaw) return null;

  const address = addressRaw.toLowerCase();
  const byChain = prices.get(`${chainId}:${address}`);
  if (byChain != null) return byChain;

  const byAddress = prices.get(address);
  if (byAddress != null) return byAddress;

  return symbol ? prices.get(symbol.toUpperCase()) ?? null : null;
}

function usdString(amount: string | null | undefined, decimals: number, price: number | null): string | null {
  if (price == null || amount == null) return null;
  const value = Number(formatUnits(BigInt(amount), decimals)) * price;
  if (!Number.isFinite(value)) return null;
  const precision = value === 0 ? 2 : value < 1 ? 6 : 2;
  return value.toFixed(precision);
}

function feeWithUsd(fee: TxFee | null): TxFee | null {
  if (fee == null) return null;
  return {
    ...fee,
    feeUsd: usdString(fee.feeWei, 18, nativePrice()),
  };
}

export function enrichXtUsd(xt: Xt): Xt {
  return {
    ...xt,
    valueUsd: usdString(xt.valueWei, 18, nativePrice()),
  };
}

export function enrichTransfersUsd(transfers: Transfer[], tokens: TokenMeta[]): Transfer[] {
  return transfers.map((transfer) => {
    const token =
      transfer.kind === 'eth'
        ? null
        : tokens.find(
            (meta) =>
              meta.address.toLowerCase() === transfer.token?.toLowerCase() &&
              meta.chainId === transfer.chainId,
          ) ??
          tokens.find((meta) => meta.address.toLowerCase() === transfer.token?.toLowerCase()) ??
          null;
    const price =
      transfer.kind === 'eth'
        ? nativePrice()
        : tokenPrice(transfer.chainId, transfer.token, token?.symbol);
    return {
      ...transfer,
      amountUsd: usdString(transfer.amount, token?.decimals ?? 18, price),
    };
  });
}

export function enrichMailboxFees(message: MailboxMessage): MailboxMessage {
  return {
    ...message,
    txFee: feeWithUsd(message.txFee),
  };
}

export function enrichSuperblockFees(superblock: Superblock): Superblock {
  return {
    ...superblock,
    l1TxFee: feeWithUsd(superblock.l1TxFee),
  };
}
