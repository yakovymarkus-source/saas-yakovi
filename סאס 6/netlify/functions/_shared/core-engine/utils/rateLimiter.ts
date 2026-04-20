export class SimpleRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly maxCalls: number, private readonly windowMs: number) {}

  assert(key: string): void {
    const now = Date.now();
    const timestamps = (this.hits.get(key) ?? []).filter((value) => now - value < this.windowMs);
    if (timestamps.length >= this.maxCalls) {
      throw new Error('Rate limit exceeded');
    }
    timestamps.push(now);
    this.hits.set(key, timestamps);
  }
}
