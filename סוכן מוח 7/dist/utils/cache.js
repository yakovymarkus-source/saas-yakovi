"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TtlCache = void 0;
class TtlCache {
    ttlSeconds;
    engineVersion;
    store = new Map();
    constructor(ttlSeconds, engineVersion) {
        this.ttlSeconds = ttlSeconds;
        this.engineVersion = engineVersion;
    }
    get(key) {
        const item = this.store.get(key);
        if (!item)
            return null;
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
    set(key, value, inputHash) {
        this.store.set(key, {
            key,
            value,
            inputHash,
            engineVersion: this.engineVersion,
            createdAt: new Date().toISOString(),
            expiresAt: Date.now() + this.ttlSeconds * 1000
        });
    }
    delete(key) {
        this.store.delete(key);
    }
    clear() {
        this.store.clear();
    }
}
exports.TtlCache = TtlCache;
