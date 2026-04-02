"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.externalGet = externalGet;
const env_1 = require("../config/env");
const http_1 = require("../utils/http");
const rateLimiter_1 = require("../utils/rateLimiter");
const limiter = new rateLimiter_1.SimpleRateLimiter(30, 60_000);
async function externalGet(key, url, headers) {
    limiter.assert(key);
    return (0, http_1.retry)(() => (0, http_1.fetchJson)(url, { method: 'GET', headers }, env_1.env.REQUEST_TIMEOUT_MS), 2);
}
