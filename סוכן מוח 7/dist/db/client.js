"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pool = void 0;
exports.withTransaction = withTransaction;
exports.queryDb = queryDb;
const pg_1 = require("pg");
const env_1 = require("../config/env");
exports.pool = new pg_1.Pool({
    connectionString: env_1.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
});
async function withTransaction(operation) {
    const client = await exports.pool.connect();
    try {
        await client.query('BEGIN');
        const result = await operation(client);
        await client.query('COMMIT');
        return result;
    }
    catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
    }
    finally {
        client.release();
    }
}
async function queryDb(executor, text, params = []) {
    return executor.query(text, params);
}
