import { useEffect, useState } from 'react';
import type { XtDetail } from '@cross-scout/sdk';
import { STAGE_NAMES } from '@cross-scout/sdk';
import { api } from '../lib/api';
import { chainName, formatWei, shortHex } from '../lib/format';
import { StatusBadge } from './StageBadge';

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div style={{ marginTop: 20 }}>
    <div
      className="mono"
      style={{ fontSize: 10.5, letterSpacing: 1, color: 'var(--fg-faint)', marginBottom: 10 }}
    >
      {title.toUpperCase()}
    </div>
    {children}
  </div>
);

function Timeline({ stage, failed }: { stage: number; failed: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {STAGE_NAMES.slice(1).map((name, i) => {
        const n = i + 1;
        const reached = !failed && stage >= n;
        const current = !failed && stage === n;
        return (
          <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: reached ? 'var(--accent)' : 'var(--line-2)',
                boxShadow: current ? '0 0 0 4px var(--accent-soft)' : 'none',
              }}
            />
            <span
              className="mono"
              style={{
                fontSize: 12,
                color: reached ? 'var(--fg)' : 'var(--fg-faint)',
                textTransform: 'capitalize',
              }}
            >
              {n}. {name}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', gap: 16 }}>
    <span className="mono" style={{ fontSize: 12, color: 'var(--fg-faint)' }}>
      {k}
    </span>
    <span className="mono" style={{ fontSize: 12, color: 'var(--fg-dim)', textAlign: 'right' }}>
      {v}
    </span>
  </div>
);

export function XtDrawer({
  hash,
  version,
  onClose,
}: {
  hash: string | null;
  version: number;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<XtDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!hash) {
      setDetail(null);
      return;
    }
    let live = true;
    setLoading(true);
    api
      .getXt(hash)
      .then((d) => live && setDetail(d))
      .catch(() => live && setDetail(null))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [hash, version]);

  if (!hash) return null;
  const xt = detail?.xt;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        height: '100vh',
        width: 'min(460px, 92vw)',
        background: 'var(--bg-1)',
        borderLeft: '1px solid var(--line-2)',
        boxShadow: '-24px 0 60px rgba(0,0,0,.5)',
        overflowY: 'auto',
        padding: '24px 26px 60px',
        zIndex: 40,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="mono" style={{ fontSize: 13, color: 'var(--accent)' }}>
          {shortHex(hash, 10, 6)}
        </span>
        <button
          onClick={onClose}
          style={{
            background: 'var(--bg-2)',
            border: '1px solid var(--line-2)',
            color: 'var(--fg-dim)',
            borderRadius: 8,
            padding: '5px 11px',
            fontSize: 12,
          }}
        >
          close
        </button>
      </div>

      {loading && !detail && (
        <div style={{ marginTop: 24, color: 'var(--fg-faint)', fontSize: 13 }}>loading…</div>
      )}

      {xt && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
            <StatusBadge status={xt.status} />
            <span style={{ fontSize: 14, color: 'var(--fg)' }}>
              {chainName(xt.srcChain)} → {chainName(xt.dstChain)}
            </span>
          </div>

          <Section title="Lifecycle">
            <Timeline stage={xt.stage} failed={xt.status === 'failed'} />
          </Section>

          <Section title="Transaction">
            <Row k="instance" v={shortHex(xt.instanceId, 8, 6)} />
            <Row k="period · seq" v={`${xt.period ?? '-'} · ${xt.seq ?? '-'}`} />
            <Row k="value" v={formatWei(xt.valueWei)} />
            <Row k="sender" v={shortHex(xt.sender, 8, 6)} />
            <Row k="chains" v={xt.chains.map(chainName).join(', ') || '-'} />
            <Row k="superblock" v={xt.superblockNumber ?? '-'} />
          </Section>

          {detail?.instance && (
            <Section title={`2PC votes · ${detail.instance.decision}`}>
              {detail.instance.votes.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--fg-faint)' }}>no votes yet</div>
              )}
              {detail.instance.votes.map((v) => (
                <Row
                  key={v.chainId}
                  k={chainName(v.chainId)}
                  v={
                    <span style={{ color: v.commit ? 'var(--ok)' : 'var(--bad)' }}>
                      {v.commit ? 'commit' : 'abort'}
                    </span>
                  }
                />
              ))}
            </Section>
          )}

          {detail && detail.mailbox.length > 0 && (
            <Section title="Mailbox">
              {detail.mailbox.map((m) => (
                <Row
                  key={m.id}
                  k={`${m.direction} · ${chainName(m.srcChain)}→${chainName(m.dstChain)}`}
                  v={shortHex(m.session, 6, 4)}
                />
              ))}
            </Section>
          )}

          {detail?.superblock && (
            <Section title={`Superblock #${detail.superblock.number} · ${detail.superblock.status}`}>
              <Row k="mailbox root" v={shortHex(detail.superblock.mailboxRoot, 8, 6)} />
              <Row k="xt count" v={detail.superblock.xtCount} />
              <Row k="prove ms" v={detail.superblock.proveMs ?? '-'} />
              <Row k="l1 block" v={detail.superblock.l1Block ?? '-'} />
            </Section>
          )}
        </>
      )}
    </div>
  );
}
