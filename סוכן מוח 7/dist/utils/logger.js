"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logEvent = logEvent;
exports.writeOperationalLog = writeOperationalLog;
const logsRepository_1 = require("../db/logsRepository");
function writeStructuredLine(payload, level) {
    const line = `${JSON.stringify(payload)}\n`;
    if (level === 'error') {
        process.stderr.write(line);
        return;
    }
    process.stdout.write(line);
}
async function logEvent(input) {
    const payload = {
        timestamp: new Date().toISOString(),
        ...input,
        meta: input.meta ?? {}
    };
    writeStructuredLine(payload, input.level);
    await (0, logsRepository_1.saveLog)(payload);
}
function writeOperationalLog(input) {
    writeStructuredLine({
        timestamp: input.timestamp ?? new Date().toISOString(),
        ...input,
        meta: input.meta ?? {}
    }, input.level);
}
