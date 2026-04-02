"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticate = authenticate;
const http_1 = require("../utils/http");
const usersRepository_1 = require("../db/usersRepository");
const supabaseJwksVerifier_1 = require("../auth/supabaseJwksVerifier");
async function authenticate(req, _res, next) {
    try {
        const header = req.headers.authorization;
        if (!header?.startsWith('Bearer ')) {
            throw new http_1.HttpError(401, 'Missing bearer token');
        }
        req.user = await (0, supabaseJwksVerifier_1.verifySupabaseAccessToken)(header.slice(7));
        await (0, usersRepository_1.syncSupabaseUser)({ id: req.user.id, email: req.user.email });
        next();
    }
    catch (error) {
        next(error);
    }
}
