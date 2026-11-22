import { createHash, randomBytes } from 'node:crypto';
import type { AccountRow, Store } from './store.js';

export const SESSION_COOKIE = 'nexum_session';
export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

/** Random bearer tokens. Only a SHA-256 of the token is stored, so a leaked database cannot be
 *  used to log in. */
export class Sessions {
  private readonly store: Store;
  private readonly now: () => number;

  constructor(store: Store, now: () => number) {
    this.store = store;
    this.now = now;
  }

  create(accountId: number): string {
    const token = randomBytes(32).toString('base64url');
    const t = this.now();
    this.store.insertSession(hashToken(token), accountId, t, t + SESSION_TTL_MS);
    return token;
  }

  account(token: string | undefined): AccountRow | undefined {
    if (!token) return undefined;
    return this.store.accountForSession(hashToken(token), this.now());
  }

  destroy(token: string): void {
    this.store.deleteSession(hashToken(token));
  }

  prune(): void {
    this.store.pruneSessions(this.now());
  }
}
