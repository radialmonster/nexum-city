import type { FeedItem } from '@nexum/contracts';

/** A feed item plus who should receive it (public events go to everyone). */
export type HubItem = FeedItem & { readonly audience?: readonly string[] | undefined };

export interface Subscriber {
  readonly playerId: string;
  /** Ends the connection (server shutdown). */
  readonly close: () => void;
  readonly send: (event: 'tick' | 'game' | 'heartbeat', data: unknown, id?: number) => void;
}

/** Fan-out of tick and per-player event messages to open SSE connections. */
export class Hub {
  private readonly subs = new Set<Subscriber>();

  subscribe(sub: Subscriber): () => void {
    this.subs.add(sub);
    return () => this.subs.delete(sub);
  }

  get size(): number {
    return this.subs.size;
  }

  closeAll(): void {
    for (const sub of [...this.subs]) sub.close();
    this.subs.clear();
  }

  publishTick(nowMs: number, items: readonly HubItem[]): void {
    for (const sub of this.subs) {
      try {
        for (const item of items) {
          if ((item.audience ?? item.event.actors).includes(sub.playerId)) {
            // Never send the audience list itself: it names every player.
            sub.send('game', { seq: item.seq, event: item.event }, item.seq);
          }
        }
        sub.send('tick', { nowMs });
      } catch {
        // a broken connection is cleaned up by its own abort handler
      }
    }
  }
}
