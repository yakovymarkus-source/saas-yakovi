"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateWithSchema = validateWithSchema;
const http_1 = require("../utils/http");
function validateWithSchema(schema, value, label) {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
        throw new http_1.HttpError(400, `${label} validation failed`, {
            issues: parsed.error.issues.map((issue) => ({
                path: issue.path.join('.'),
                message: issue.message
            }))
        });
    }
    return parsed.data;
}
