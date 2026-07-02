import type { MailboxMessage, Superblock, Xt } from '@cross-scout/sdk';
import type { ChainView } from '../lib/chains';
import { chainView } from '../lib/chains';
import { fmtMaybe, formatDurationMs, formatEthCompact, shortHex, stageName, timeAgo } from '../lib/format';
import { CopyButton } from '../ui/CopyButton';
import { ChainStack, Glyph, StatusPill } from './primitives';

export function TxRow({
  xt,
  chains,
  onClick,
}: {
  xt: Xt;
  chains: Map<number, ChainView>;
  onClick: () => void;
}) {
  const src = chainView(chains, xt.srcChain);
  const dst = chainView(chains, xt.dstChain);
  return (
    <button type="button" className="tx-row" onClick={onClick}>
      <div className="tx-route">
        <Glyph chain={src} />
        <span className="route-line" />
        <Glyph chain={dst} />
        <div className="route-copy">
          <strong>{src.name} to {dst.name}</strong>
          <span className="mono">{shortHex(xt.xtHash, 8, 5)}</span>
        </div>
      </div>
      <div className="tx-cell">
        <span className="mono">{shortHex(xt.instanceId, 6, 8)}</span>
        <small className="mono">{xt.superblockNumber ? `superblock #${xt.superblockNumber}` : stageName(xt.stage)}</small>
      </div>
      <div className="tx-cell">
        <span>{Math.max(1, xt.chains.length)} chains</span>
        <small>{formatEthCompact(xt.valueWei)}</small>
      </div>
      <div className="tx-cell">
        <span>{xt.superblockNumber ? `#${xt.superblockNumber}` : 'pending'}</span>
        <small>{timeAgo(xt.updatedAt)}</small>
      </div>
      <div className="tx-status">
        <StatusPill status={xt.status} />
      </div>
    </button>
  );
}

export function TxTableRow({
  xt,
  chains,
  onClick,
}: {
  xt: Xt;
  chains: Map<number, ChainView>;
  onClick: () => void;
}) {
  const src = chainView(chains, xt.srcChain);
  const dst = chainView(chains, xt.dstChain);
  return (
    <button type="button" className="tx-table-row" onClick={onClick}>
      <span className="mono tx-time">{timeAgo(xt.updatedAt)}</span>
      <span className="tx-hash-cell">
        <strong className="mono">{shortHex(xt.xtHash, 6, 6)}</strong>
        <CopyButton value={xt.xtHash} />
      </span>
      <span className="tx-address-cell">
        <Glyph chain={src} size={18} />
        <span>
          <strong className="mono">{shortHex(xt.sender, 6, 5)}</strong>
          <small>{formatEthCompact(xt.valueWei)}</small>
        </span>
      </span>
      <span className="tx-direction" aria-hidden="true">
        -&gt;
      </span>
      <span className="tx-address-cell">
        <Glyph chain={dst} size={18} />
        <span>
          <strong className="mono">{dst.name}</strong>
          <small>{xt.superblockNumber ? `superblock #${xt.superblockNumber}` : 'awaiting settlement'}</small>
        </span>
      </span>
      <span className="tx-protocol-cell">
        <strong>{xt.chains.length > 2 ? 'Multi-hop XT' : 'Mailbox XT'}</strong>
        <small className="mono">{shortHex(xt.instanceId, 6, 5)}</small>
      </span>
      <span className="tx-status-cell">
        <StatusPill status={xt.status} />
      </span>
    </button>
  );
}

export function SuperblockRow({
  sb,
  chains,
  onClick,
}: {
  sb: Superblock;
  chains: Map<number, ChainView>;
  onClick: () => void;
}) {
  return (
    <button type="button" className="dense-table-row sb-table-row" onClick={onClick}>
      <span className="tx-hash-cell">
        <strong className="mono">#{sb.number}</strong>
        <CopyButton value={sb.hash} />
        <small className="mono">{shortHex(sb.hash)}</small>
      </span>
      <span className="tx-status-cell">
        <StatusPill status={sb.status} />
      </span>
      <span className="mono tx-time">{fmtMaybe(sb.l1Block)}</span>
      <ChainStack ids={sb.chains.map((entry) => entry.chainId)} chains={chains} />
      <span className="tx-protocol-cell">
        <strong>{sb.xtCount} XTs</strong>
        <small className="mono">{formatDurationMs(sb.proveMs)} prove</small>
      </span>
      <span className="tx-hash-cell">
        <strong className="mono">{shortHex(sb.rootClaim, 8, 6)}</strong>
        <CopyButton value={sb.rootClaim} />
      </span>
      <span className="mono tx-time right">{sb.proposedAt ? timeAgo(sb.proposedAt) : '-'}</span>
    </button>
  );
}

export function MessageRow({ message, chains }: { message: MailboxMessage; chains: Map<number, ChainView> }) {
  const src = chainView(chains, message.srcChain);
  const dst = chainView(chains, message.dstChain);
  return (
    <div className="message-row">
      <span className={message.direction === 'in' ? 'message-dir in' : 'message-dir out'}>{message.direction}</span>
      <span className="tx-address-cell">
        <Glyph chain={src} size={20} />
        <span>
          <strong>{src.name} -&gt; {dst.name}</strong>
          <small className="mono">{message.label ?? 'message'} - {shortHex(message.session, 8, 5)}</small>
        </span>
      </span>
      <span className="mono tx-time">{message.superblockNumber ? `#${message.superblockNumber}` : 'pending'}</span>
      <span className="mono tx-time right">{timeAgo(message.ts)}</span>
    </div>
  );
}

export function MailboxTableRow({ message, chains }: { message: MailboxMessage; chains: Map<number, ChainView> }) {
  const src = chainView(chains, message.srcChain);
  const dst = chainView(chains, message.dstChain);
  return (
    <div className="dense-table-row mailbox-table-row">
      <span className={message.direction === 'in' ? 'message-dir in' : 'message-dir out'}>
        {message.direction === 'in' ? 'INBOX' : 'OUTBOX'}
      </span>
      <span className="tx-address-cell">
        <Glyph chain={src} size={18} />
        <span>
          <strong>{src.name}</strong>
          <small className="mono">{shortHex(message.sender, 5, 4)}</small>
        </span>
      </span>
      <span className="tx-direction" aria-hidden="true">
        -&gt;
      </span>
      <span className="tx-address-cell">
        <Glyph chain={dst} size={18} />
        <span>
          <strong>{dst.name}</strong>
          <small className="mono">{shortHex(message.receiver, 5, 4)}</small>
        </span>
      </span>
      <span className="tx-protocol-cell">
        <strong>{message.label ?? 'message'}</strong>
        <small>{message.direction === 'in' ? 'received' : 'emitted'}</small>
      </span>
      <span className="tx-hash-cell">
        <strong className="mono">session {shortHex(message.session, 4, 3)}</strong>
        <CopyButton value={message.session} />
      </span>
      <span className="mono tx-time">{message.superblockNumber ? `#${message.superblockNumber}` : 'pending'}</span>
      <span className="mono tx-time right">{timeAgo(message.ts)}</span>
    </div>
  );
}

/** Block hash of the most recent message in the given direction. */
export function mailboxAnchor(messages: MailboxMessage[], direction: 'in' | 'out'): string {
  return shortHex(messages.find((message) => message.direction === direction)?.blockHash, 9, 6);
}
