"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncSupabaseUser = syncSupabaseUser;
exports.findUserById = findUserById;
const client_1 = require("./client");
const http_1 = require("../utils/http");
async function syncSupabaseUser(input, executor = client_1.pool) {
    const id = input.id?.trim();
    const email = input.email?.trim().toLowerCase();
    if (!id || !email) {
        throw new http_1.HttpError(400, 'Supabase user identity is incomplete');
    }
    const { rows } = await (0, client_1.queryDb)(executor, `INSERT INTO users (id, email)
     VALUES ($1, $2)
     ON CONFLICT (id)
     DO UPDATE SET email = EXCLUDED.email, updated_at = NOW()
     RETURNING id, email, created_at, updated_at`, [id, email]);
    return rows[0];
}
async function findUserById(id, executor = client_1.pool) {
    const { rows } = await (0, client_1.queryDb)(executor, `SELECT id, email, created_at, updated_at FROM users WHERE id = $1 LIMIT 1`, [id]);
    return rows[0] ?? null;
}
