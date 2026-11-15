import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite');
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DEFAULT_DB_PATH = path.resolve(__dirname, '../data/app.db');

/**
 * Initializes SQLite schema and seeds initial data if the database is newly created.
 * Uses Node's built-in node:sqlite DatabaseSync module.
 *
 * @param {string} [dbPath] - Path to the SQLite database file, or ':memory:'.
 * @returns {DatabaseSync} SQLite database instance with compatibility helpers.
 */
export function initDb(dbPath = DEFAULT_DB_PATH) {
  // Ensure the target directory exists for file-based databases
  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new DatabaseSync(dbPath);

  // Helper shim: pragma(sql) runs db.exec('PRAGMA ' + sql)
  db.pragma = function (sql) {
    db.exec('PRAGMA ' + sql + ';');
  };

  // Helper shim: transaction(fn) wraps fn in BEGIN / COMMIT with ROLLBACK on error
  db.transaction = function (fn) {
    return function (...args) {
      db.exec('BEGIN');
      try {
        const result = fn(...args);
        db.exec('COMMIT');
        return result;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    };
  };

  // Wrap db.prepare so that stmt.run consistently returns lastInsertRowid and changes as numbers
  // (prevents BigInt serialization quirks in Express JSON responses)
  const originalPrepare = db.prepare.bind(db);
  db.prepare = function (sql) {
    const stmt = originalPrepare(sql);
    const originalRun = stmt.run.bind(stmt);
    stmt.run = function (...params) {
      const result = originalRun(...params);
      return {
        changes: typeof result.changes === 'bigint' ? Number(result.changes) : result.changes,
        lastInsertRowid: typeof result.lastInsertRowid === 'bigint' ? Number(result.lastInsertRowid) : result.lastInsertRowid
      };
    };
    return stmt;
  };

  // Enable WAL mode for concurrency and enforce foreign key constraints
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  // Create tables according to data model
  db.exec(`
    -- Users table
    -- NOTE: Passwords are intentionally stored in plain text here for seeded demo accounts
    -- as this lightweight exercise focuses on document, sharing, and persistence logic rather than enterprise auth.
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password TEXT NOT NULL
    );

    -- Documents table
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      owner_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      content_json TEXT NOT NULL,
      content_text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Document shares table
    CREATE TABLE IF NOT EXISTS shares (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('editor', 'viewer')),
      UNIQUE(document_id, user_id),
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Active user sessions (bearer tokens)
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // Seed demo data on first run if database is empty
  seedInitialData(db);

  return db;
}

/**
 * Seeds demo users and the initial sample document if the users table is empty.
 * @param {DatabaseSync} db
 */
function seedInitialData(db) {
  const countRow = db.prepare('SELECT COUNT(*) as count FROM users').get();
  const userCount = Number(countRow?.count ?? 0);
  if (userCount > 0) {
    return;
  }

  const insertUser = db.prepare('INSERT INTO users (name, email, password) VALUES (?, ?, ?)');

  // Seed exactly three users: Maya Chen, Jordan Lee, Priya Nair
  const maya = insertUser.run('Maya Chen', 'maya@demo.io', 'demo1234');
  const jordan = insertUser.run('Jordan Lee', 'jordan@demo.io', 'demo1234');
  insertUser.run('Priya Nair', 'priya@demo.io', 'demo1234');

  // Seed one sample document owned by Maya, shared to Jordan as editor
  const sampleDocId = crypto.randomUUID();
  const now = new Date().toISOString();
  const sampleTitle = 'Welcome to Ajaia Docs';
  const sampleText = 'Welcome to Ajaia Docs! This is a lightweight collaborative document editor inspired by Google Docs.';

  const sampleTipTapJson = JSON.stringify({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: sampleText
          }
        ]
      }
    ]
  });

  db.prepare(`
    INSERT INTO documents (id, owner_id, title, content_json, content_text, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(sampleDocId, maya.lastInsertRowid, sampleTitle, sampleTipTapJson, sampleText, now, now);

  db.prepare(`
    INSERT INTO shares (document_id, user_id, role)
    VALUES (?, ?, ?)
  `).run(sampleDocId, jordan.lastInsertRowid, 'editor');
}

let defaultDbInstance = null;

/**
 * Returns a database instance. Uses a singleton for the default path,
 * or creates a new connection for custom paths (such as in tests).
 * @param {string} [dbPath]
 * @returns {DatabaseSync}
 */
export function getDb(dbPath = DEFAULT_DB_PATH) {
  if (dbPath === DEFAULT_DB_PATH) {
    if (!defaultDbInstance) {
      defaultDbInstance = initDb(DEFAULT_DB_PATH);
    }
    return defaultDbInstance;
  }
  return initDb(dbPath);
}

export default getDb;
