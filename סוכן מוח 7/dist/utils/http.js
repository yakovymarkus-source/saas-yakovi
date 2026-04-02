"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HttpError = void 0;
exports.fetchJson = fetchJson;
exports.retry = retry;
const env_1 = require("../config/env");
class HttpError extends Error {
    status;
    details;
    constructor(status, message, details) {
        super(message);
        this.status = status;
        this.details = details;
    }
}
exports.HttpError = HttpError;
async function fetchJson(url, init, timeoutMs = env_1.env.REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { ...init, signal: controller.signal });
        const text = await response.text();
        const data = text ? JSON.parse(text) : {};
        if (!response.ok) {
            throw new HttpError(response.status, `External request failed: ${response.status}`, data);
        }
        return data;
    }
    catch (error) {
        if (error instanceof HttpError)
            throw error;
        throw new HttpError(502, 'External request failure', { cause: error.message });
    }
    finally {
        clearTimeout(timeout);
    }
}
async function retry(operation, retries = 2) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
            return await operation();
        }
        catch (error) {
            lastError = error;
            if (attempt === retries)
                break;
            await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
        }
    }
    throw lastError;
}
