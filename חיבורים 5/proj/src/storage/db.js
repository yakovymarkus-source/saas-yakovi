const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const dataDir = path.join(__dirname, '../../data');
const dbPath = path.join(dataDir, 'app.db');

let db;

function getDb() {
  if (!db) {
    fs.mkdirSync(dataDir, { recursive: true });
    db = new DatabaseSync(dbPath);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA busy_timeout = 5000');
    initializeSchema(db);
  }
  return db;
}

function initializeSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT,
      analysis_history TEXT NOT NULL DEFAULT '[]',
      campaigns TEXT NOT NULL DEFAULT '[]',
      linkage_summary TEXT NOT NULL DEFAULT '{"analyses_count":0,"campaigns_count":0,"last_activity_at":null}'
    );

    CREATE TABLE IF NOT EXISTS analyses (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      input TEXT,
      status TEXT NOT NULL,
      result TEXT,
      created_at TEXT NOT NULL,
      processed_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_analyses_user_id ON analyses(user_id);

    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT,
      payload TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_campaigns_user_id ON campaigns(user_id);

    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action_type TEXT NOT NULL,
      user_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      campaign_id TEXT,
      analysis_id TEXT,
      status TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_history_user_id ON history(user_id);
    CREATE INDEX IF NOT EXISTS idx_history_analysis_id ON history(analysis_id);
    CREATE INDEX IF NOT EXISTS idx_history_campaign_id ON history(campaign_id);
  `);
}


function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

function resetDatabase() {
  closeDb();
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }
  const walPath = `${dbPath}-wal`;
  const shmPath = `${dbPath}-shm`;
  if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
  if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
}

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function serializeJson(value, fallback) {
  return JSON.stringify(value === undefined ? fallback : value);
}

function run(sql, params = {}) {
  return getDb().prepare(sql).run(params);
}

function get(sql, params = {}) {
  return getDb().prepare(sql).get(params);
}

function all(sql, params = {}) {
  return getDb().prepare(sql).all(params);
}

function transaction(fn) {
  return (...args) => {
    const database = getDb();
    database.exec('BEGIN IMMEDIATE');
    try {
      const result = fn(...args);
      database.exec('COMMIT');
      return result;
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  };
}

module.exports = {
  getDb,
  run,
  get,
  all,
  transaction,
  parseJson,
  serializeJson,
  dbPath,
  closeDb,
  resetDatabase
};
