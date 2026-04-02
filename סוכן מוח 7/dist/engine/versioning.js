"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ENGINE_VERSION = void 0;
exports.buildVersionedKey = buildVersionedKey;
exports.ENGINE_VERSION = '1.0.0';
function buildVersionedKey(inputHash, version = exports.ENGINE_VERSION) {
    return `${version}:${inputHash}`;
}
