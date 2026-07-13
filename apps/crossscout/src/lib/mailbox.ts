import type { MailboxMessage } from '@cross-scout/sdk';
import { shortHex } from './format';

/** Block hash of the most recent message in the given direction. */
export function mailboxAnchor(messages: MailboxMessage[], direction: 'in' | 'out'): string {
  return shortHex(messages.find((message) => message.direction === direction)?.blockHash, 9, 6);
}
