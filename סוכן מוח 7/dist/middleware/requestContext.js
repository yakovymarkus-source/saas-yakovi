"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestContext = requestContext;
const id_1 = require("../utils/id");
function requestContext(req, res, next) {
    req.requestId = (0, id_1.createRequestId)();
    res.setHeader('x-request-id', req.requestId);
    next();
}
