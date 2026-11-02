import { getDb } from '../../backend/services/db.mjs';
import { newId, nowIso } from '../../backend/services/id.mjs';
import { env } from '../../backend/config/env.mjs';

export function createMemory({ kind, subject = null, content, tags = null, enabled = true }) {
  kind = kind || 'note';
  if (typeof content !== 'string' || !content.trim()) throw new Error('Conteudo da memoria vazio');
  if (!env.MEMORY_ENABLED) throw new Error('Memoria desativada');
  const db = getDb();
  const count = db.prepare('SELECT COUNT(*) AS c FROM memories').get().c;
  if (count >= env.MEMORY_MAX_ITEMS) throw new Error('Limite de memoria atingido');
  const id = newId();
  const now = nowIso();
  db.prepare('INSERT INTO memories (id,kind,subject,content,tags,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, kind, subject, content, tags, enabled ? 1 : 0, now, now);
  return getMemory(id);
}

export function getMemory(id) {
  const db = getDb();
  const r = db.prepare('SELECT * FROM memories WHERE id=?').get(id);
  return r ? normalize(r) : null;
}

export function listMemories({ kind = null, enabled = null, limit = 200, offset = 0 } = {}) {
  const db = getDb();
  let sql = 'SELECT * FROM memories WHERE 1=1';
  const params = [];
  if (kind) { sql += ' AND kind=?'; params.push(kind); }
  if (enabled !== null) { sql += ' AND enabled=?'; params.push(enabled ? 1 : 0); }
  sql += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  return db.prepare(sql).all(...params).map(normalize);
}

export function updateMemory(id, patch) {
  const db = getDb();
  const m = getMemory(id);
  if (!m) return null;
  const kind = patch.kind !== undefined ? patch.kind : m.kind;
  const subject = patch.subject !== undefined ? patch.subject : m.subject;
  const content = patch.content !== undefined ? patch.content : m.content;
  const tags = patch.tags !== undefined ? patch.tags : m.tags;
  const enabled = patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : (m.enabled ? 1 : 0);
  db.prepare('UPDATE memories SET kind=?,subject=?,content=?,tags=?,enabled=?,updated_at=? WHERE id=?')
    .run(kind, subject, content, tags, enabled, nowIso(), id);
  return getMemory(id);
}

export function deleteMemory(id) {
  const db = getDb();
  return db.prepare('DELETE FROM memories WHERE id=?').run(id).changes > 0;
}

export function searchMemories(q, limit = 50) {
  const db = getDb();
  if (!q || !q.trim()) return [];
  // FTS
  try {
    const rows = db.prepare(`SELECT m.* FROM memories m JOIN memories_fts f ON f.rowid=m.rowid WHERE memories_fts MATCH ? ORDER BY rank LIMIT ?`).all(q, limit);
    if (rows.length) return rows.map(normalize);
    throw new Error('sem resultado FTS'); // cai no LIKE (cobre prefixos/acentos que o FTS nao acha)
  } catch {
    const like = '%' + String(q).replace(/[\\%_]/g, '\\$&') + '%';
    return db.prepare("SELECT * FROM memories WHERE content LIKE ? ESCAPE '\\' OR subject LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT ?").all(like, like, like, limit).map(normalize);
  }
}

export function clearMemories() {
  const db = getDb();
  db.prepare('DELETE FROM memories').run();
}

function normalize(r) {
  return { ...r, enabled: r.enabled === 1 };
}
