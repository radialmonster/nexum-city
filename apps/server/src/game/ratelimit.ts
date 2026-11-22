/** In-memory fixed-window rate limiter. One instance per concern; keys are free-form strings. */
export class RateLimiter {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  private readonly max: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(max: number, windowMs: number, now: () => number) {
    this.max = max;
    this.windowMs = windowMs;
    this.now = now;
  }

  /** Counts one attempt. Returns 0 when allowed, else the seconds until the window resets. */
  hit(key: string): number {
    const t = this.now();
    if (this.buckets.size > 10_000) this.prune(t);
    let b = this.buckets.get(key);
    if (!b || b.resetAt <= t) {
      b = { count: 0, resetAt: t + this.windowMs };
      this.buckets.set(key, b);
    }
    b.count += 1;
    return b.count > this.max ? Math.max(1, Math.ceil((b.resetAt - t) / 1000)) : 0;
  }

  /** Seconds until allowed again if `key` is already over the limit, without counting. */
  blocked(key: string): number {
    const b = this.buckets.get(key);
    const t = this.now();
    return b && b.resetAt > t && b.count >= this.max ? Math.ceil((b.resetAt - t) / 1000) : 0;
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  private prune(t: number): void {
    for (const [k, b] of this.buckets) if (b.resetAt <= t) this.buckets.delete(k);
  }
}
