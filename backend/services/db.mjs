import { DatabaseSync } from 'node:sqlite';
import { env, resolvePath } from '../config/env.mjs';
import fs from 'node:fs';
import path from 'node:path';

let db = null;

export function getDb() {
  if (db) return db;
  const dbPath = resolvePath(env.DB_PATH);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db);
  return db;
}

function runMigrations(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    );
  `);
  const applied = new Set(database.prepare('SELECT name FROM schema_migrations').all().map(r => r.name));
  const migrations = [
    { name: '001_init', sql: MIGRATION_001 },
    { name: '002_memory', sql: MIGRATION_002 },
    { name: '003_settings', sql: MIGRATION_003 },
    { name: '004_files', sql: MIGRATION_004 },
    { name: '005_tasks', sql: MIGRATION_005 },
    { name: '006_unified_conversations', sql: MIGRATION_006 },
  ];
  for (const m of migrations) {
    if (applied.has(m.name)) continue;
    database.exec('BEGIN');
    try {
      database.exec(m.sql);
      database.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(m.name, new Date().toISOString());
      database.exec('COMMIT');
    } catch (e) {
      database.exec('ROLLBACK');
      throw e;
    }
  }
}

const MIGRATION_001 = `
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  model TEXT,
  provider TEXT,
  agent_id TEXT,
  archived INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  model TEXT,
  provider TEXT,
  tokens_in INTEGER,
  tokens_out INTEGER,
  error TEXT,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);
`;

const MIGRATION_002 = `
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  subject TEXT,
  content TEXT NOT NULL,
  tags TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memories_kind ON memories(kind);
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(content, subject, tags, content='memories', content_rowid='rowid');
CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, content, subject, tags) VALUES (new.rowid, new.content, new.subject, new.tags);
END;
CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, subject, tags) VALUES ('delete', old.rowid, old.content, old.subject, old.tags);
END;
CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, subject, tags) VALUES ('delete', old.rowid, old.content, old.subject, old.tags);
  INSERT INTO memories_fts(rowid, content, subject, tags) VALUES (new.rowid, new.content, new.subject, new.tags);
END;
`;

const MIGRATION_003 = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

const MIGRATION_004 = `
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  size INTEGER NOT NULL,
  mime TEXT,
  kind TEXT,
  created_at TEXT NOT NULL,
  metadata TEXT
);
`;

const MIGRATION_005 = `
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  conversation_id TEXT,
  goal TEXT NOT NULL,
  status TEXT NOT NULL,
  plan TEXT,
  result TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS task_steps (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  agent_id TEXT,
  tool TEXT,
  input TEXT,
  output TEXT,
  error TEXT,
  started_at TEXT,
  finished_at TEXT,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
`;

const MIGRATION_006 = `
ALTER TABLE conversations ADD COLUMN is_unified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN source_conversation_title TEXT;
ALTER TABLE messages ADD COLUMN origin_message_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_unified_conversation ON conversations(is_unified) WHERE is_unified=1;
CREATE UNIQUE INDEX IF NOT EXISTS idx_unified_origin_message ON messages(conversation_id,origin_message_id) WHERE origin_message_id IS NOT NULL;
`;

export function closeDb() {
  if (db) { db.close(); db = null; }
}
