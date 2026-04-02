"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SimpleRateLimiter = void 0;
class SimpleRateLimiter {
    maxCalls;
    windowMs;
    hits = new Map();
    constructor(maxCalls, windowMs) {
        this.maxCalls = maxCalls;
        this.windowMs = windowMs;
    }
    assert(key) {
        const now = Date.now();
        const timestamps = (this.hits.get(key) ?? []).filter((value) => now - value < this.windowMs);
        if (timestamps.length >= this.maxCalls) {
            throw new Error('Rate limit exceeded');
        }
        timestamps.push(now);
        this.hits.set(key, timestamps);
    }
}
exports.SimpleRateLimiter = SimpleRateLimiter;
