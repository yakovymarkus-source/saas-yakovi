import { CacheRecord } from '../types/domain';

export class TtlCache<T> {
  private readonly store = new Map<string, CacheRecord<T>>();

  constructor(
    private readonly ttlSeconds: number,
    private readonly engineVersion: string
  ) {}

  get(key: string): T | null {
    const item = this.store.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
      this.store.delete(key);
      return null;
    }
    if (item.engineVersion !== this.engineVersion) {
      this.store.delete(key);
      return null;
    }
    return item.value;
  }

  set(key: string, value: T, inputHash: string): void {
    this.store.set(key, {
      key,
      value,
      inputHash,
      engineVersion: this.engineVersion,
      createdAt: new Date().toISOString(),
      expiresAt: Date.now() + this.ttlSeconds * 1000
    });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}
