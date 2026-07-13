import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatEther, formatUnits } from 'viem';
import type { ActivityPoint, AssetVolume } from '@cross-scout/sdk';
import { api } from '../lib/api';
import type { ChainView } from '../lib/chains';
import { compactNumber, fmt, formatEthCompact, formatTokenAmount, shortHex } from '../lib/format';
import { AreaChart } from './AreaChart';
import { AssetIcon } from './TokenAsset';
import { ChainStack, EmptyPanel } from './primitives';

function assetKey(asset: AssetVolume): string {
  return asset.token ? `${asset.token.chainId}:${asset.token.address}` : 'eth';
}

function assetSymbol(asset: AssetVolume): string {
  if (!asset.token) return 'ETH';
  return asset.token.symbol ?? shortHex(asset.token.address, 5, 3);
}

function assetAmount(asset: AssetVolume): string {
  if (!asset.token) return formatEthCompact(asset.amount);
  return formatTokenAmount(asset.amount, asset.token.decimals, asset.token.symbol);
}

export function TopAssets({
  assets,
  chains,
  window,
}: {
  assets: AssetVolume[];
  chains: Map<number, ChainView>;
  window: string;
}) {
  const [selected, setSelected] = useState<string | null>(null);

  const active =
    (selected != null ? assets.find((asset) => assetKey(asset) === selected) : undefined) ??
    assets[0] ??
    null;

  const series = useQuery<ActivityPoint[]>({
    queryKey: ['assetActivity', window, active?.token?.address ?? 'eth'],
    queryFn: () => api.getAssetActivity({ window, token: active?.token?.address }),
    enabled: active != null,
  });

  if (assets.length === 0) {
    return <EmptyPanel>no transferred assets in the current window</EmptyPanel>;
  }

  const formatSeriesValue = (value: number) => {
    if (!active || !active.token) return `${compactNumber(value)} ETH`;
    const symbol = active.token.symbol;
    return symbol ? `${compactNumber(value)} ${symbol}` : compactNumber(value);
  };

  return (
    <div className="assets-layout">
      <div className="assets-list">
        <div className="table-head dense assets-head">
          <span>Asset</span>
          <span>Volume</span>
          <span>Transfers</span>
          <span>Chains</span>
        </div>
        {assets.map((asset) => {
          const key = assetKey(asset);
          const isActive = active != null && assetKey(active) === key;
          return (
            <button
              type="button"
              key={key}
              className={isActive ? 'dense-table-row asset-row active' : 'dense-table-row asset-row'}
              onClick={() => setSelected(key)}
            >
              <span className="asset-symbol">
                <AssetIcon token={asset.token} native={!asset.token} size={22} />
                <strong>{assetSymbol(asset)}</strong>
              </span>
              <span className="mono">{assetAmount(asset)}</span>
              <span className="mono">{fmt(asset.transfers)}</span>
              <ChainStack ids={asset.chains} chains={chains} />
            </button>
          );
        })}
      </div>
      <div className="assets-chart">
        <div className="flow-labels">
          <span>{active ? `${assetSymbol(active)} Activity` : 'Activity'}</span>
          <span className="mono">{window}</span>
        </div>
        <AreaChart
          points={(series.data ?? []).map((point) => ({
            ts: point.bucket,
            value: active?.token
              ? Number(formatUnits(BigInt(point.volumeWei), active.token.decimals ?? 18))
              : Number(formatEther(BigInt(point.volumeWei))),
          }))}
          formatValue={formatSeriesValue}
          empty={series.isPending ? 'loading asset activity...' : 'no activity for this asset in the window'}
        />
      </div>
    </div>
  );
}
