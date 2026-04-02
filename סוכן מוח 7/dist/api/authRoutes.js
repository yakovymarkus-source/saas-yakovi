"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRoutes = void 0;
const express_1 = require("express");
const schemas_1 = require("../auth/schemas");
const supabaseAuth_1 = require("../auth/supabaseAuth");
const usersRepository_1 = require("../db/usersRepository");
const http_1 = require("../utils/http");
exports.authRoutes = (0, express_1.Router)();
async function persistSupabaseUser(auth) {
    if (!auth.user?.id || !auth.user.email) {
        throw new http_1.HttpError(502, 'Supabase auth response did not include a user identity');
    }
    await (0, usersRepository_1.syncSupabaseUser)({
        id: auth.user.id,
        email: auth.user.email
    });
}
exports.authRoutes.post('/register', async (req, res, next) => {
    try {
        const payload = schemas_1.authSchema.parse(req.body);
        const auth = await (0, supabaseAuth_1.signUpWithSupabase)(payload.email, payload.password);
        await persistSupabaseUser(auth);
        res.status(201).json({
            ok: true,
            token: auth.access_token,
            refreshToken: auth.refresh_token ?? null,
            user: auth.user ?? null
        });
    }
    catch (error) {
        next(error);
    }
});
exports.authRoutes.post('/login', async (req, res, next) => {
    try {
        const payload = schemas_1.authSchema.parse(req.body);
        const auth = await (0, supabaseAuth_1.signInWithSupabase)(payload.email, payload.password);
        await persistSupabaseUser(auth);
        res.json({
            ok: true,
            token: auth.access_token,
            refreshToken: auth.refresh_token ?? null,
            user: auth.user ?? null
        });
    }
    catch (error) {
        next(error);
    }
});
