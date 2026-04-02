"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasPermission = hasPermission;
exports.requirePermission = requirePermission;
const http_1 = require("../utils/http");
const featureFlags_1 = require("../config/featureFlags");
const rolePermissions = {
    authenticated: ['analysis:run', 'analysis:read', 'analysis:export'],
    service_role: ['analysis:run', 'analysis:read', 'analysis:export'],
    anon: []
};
function hasPermission(user, permission) {
    const direct = user.permissions ?? [];
    if (direct.includes(permission))
        return true;
    const roles = user.roles.length ? user.roles : ['authenticated'];
    return roles.some((role) => (rolePermissions[role] ?? []).includes(permission));
}
function requirePermission(user, permission) {
    if (!featureFlags_1.featureFlags.enableStrictPermissions)
        return;
    if (!hasPermission(user, permission)) {
        throw new http_1.HttpError(403, `Missing permission: ${permission}`);
    }
}
