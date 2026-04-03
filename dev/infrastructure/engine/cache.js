class MemoryCache {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.store = new Map();
    this.writeLocks = new Map();
  }

  _isExpired(record) {
    return !record || (record.expiresAt !== null && record.expiresAt <= this.now());
  }

  async get(key) {
    const record = this.store.get(key);
    if (this._isExpired(record)) {
      this.store.delete(key);
      return null;
    }
    return record.value;
  }

  async set(key, value, ttlMs = 0) {
    const ttl = Number.isFinite(ttlMs) ? Math.max(0, ttlMs) : 0;
    const previousLock = this.writeLocks.get(key) || Promise.resolve();
    const nextLock = previousLock.then(async () => {
      const expiresAt = ttl > 0 ? this.now() + ttl : null;
      const cloned = JSON.parse(JSON.stringify(value));
      this.store.set(key, { value: cloned, expiresAt });
      return cloned;
    });

    this.writeLocks.set(key, nextLock);
    try {
      return await nextLock;
    } finally {
      if (this.writeLocks.get(key) === nextLock) {
        this.writeLocks.delete(key);
      }
    }
  }

  async invalidate(key) {
    this.store.delete(key);
    this.writeLocks.delete(key);
  }

  async clear() {
    this.store.clear();
    this.writeLocks.clear();
  }
}

module.exports = {
  MemoryCache
};
