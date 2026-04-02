"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = errorHandler;
const zod_1 = require("zod");
const http_1 = require("../utils/http");
const logger_1 = require("../utils/logger");
function errorHandler(error, req, res, _next) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    (0, logger_1.writeOperationalLog)({
        level: 'error',
        type: 'request_failed',
        message,
        requestId: req.requestId,
        userId: req.user?.id,
        meta: {
            path: req.path,
            method: req.method,
            errorName: error instanceof Error ? error.name : 'UnknownError'
        }
    });
    if (error instanceof zod_1.ZodError) {
        res.status(400).json({ ok: false, error: 'VALIDATION_ERROR', details: error.flatten(), requestId: req.requestId });
        return;
    }
    if (error instanceof http_1.HttpError) {
        res.status(error.status).json({ ok: false, error: error.message, details: error.details, requestId: req.requestId });
        return;
    }
    res.status(500).json({ ok: false, error: 'INTERNAL_SERVER_ERROR', message, requestId: req.requestId });
}
