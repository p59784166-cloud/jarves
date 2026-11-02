import { getDb } from '../../backend/services/db.mjs';
import { newId, nowIso } from '../../backend/services/id.mjs';

export function createConversation({ title = 'Nova conversa', model = null, provider = null, agentId = null } = {}) {
  const db = getDb();
  const id = newId();
  const now = nowIso();
  db.prepare(`INSERT INTO conversations (id,title,created_at,updated_at,model,provider,agent_id) VALUES (?,?,?,?,?,?,?)`)
    .run(id, title, now, now, model, provider, agentId);
  return getConversation(id);
}

export function getConversation(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) || null;
}

export function listConversations({ limit = 100, offset = 0, search = '' } = {}) {
  const db = getDb();
  if (search) {
    const like = likePattern(search);
    return db.prepare(`SELECT * FROM conversations WHERE archived=0 AND (title LIKE ? ESCAPE '\\' OR id IN (SELECT conversation_id FROM messages WHERE content LIKE ? ESCAPE '\\')) ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
      .all(like, like, limit, offset);
  }
  return db.prepare('SELECT * FROM conversations WHERE archived=0 ORDER BY updated_at DESC LIMIT ? OFFSET ?').all(limit, offset);
}

export function updateConversation(id, patch) {
  const db = getDb();
  const c = getConversation(id);
  if (!c) return null;
  const title = patch.title !== undefined ? patch.title : c.title;
  const model = patch.model !== undefined ? patch.model : c.model;
  const provider = patch.provider !== undefined ? patch.provider : c.provider;
  const newAgent = patch.agent_id !== undefined ? patch.agent_id : patch.agentId;
  const agentId = newAgent !== undefined ? newAgent : c.agent_id;
  const archived = patch.archived !== undefined ? (patch.archived ? 1 : 0) : c.archived;
  db.prepare('UPDATE conversations SET title=?,model=?,provider=?,agent_id=?,archived=?,updated_at=? WHERE id=?')
    .run(title, model, provider, agentId, archived, nowIso(), id);
  return getConversation(id);
}

export function deleteConversation(id) {
  const db = getDb();
  const r = db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
  return r.changes > 0;
}

export function touchConversation(id) {
  const db = getDb();
  db.prepare('UPDATE conversations SET updated_at=? WHERE id=?').run(nowIso(), id);
}

export function addMessage({ conversationId, role, content, model = null, provider = null, error = null }) {
  const db = getDb();
  const id = newId();
  const now = nowIso();
  db.prepare(`INSERT INTO messages (id,conversation_id,role,content,created_at,model,provider,error) VALUES (?,?,?,?,?,?,?,?)`)
    .run(id, conversationId, role, content, now, model, provider, error);
  touchConversation(conversationId);
  return db.prepare('SELECT * FROM messages WHERE id=?').get(id);
}

export function listMessages(conversationId) {
  const db = getDb();
  return db.prepare('SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at ASC, rowid ASC').all(conversationId);
}

export function unifyConversations() {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    let unified = db.prepare('SELECT * FROM conversations WHERE is_unified=1').get();
    const messages = db.prepare(`
      SELECT m.*, c.title AS source_conversation_title
      FROM messages m JOIN conversations c ON c.id=m.conversation_id
      WHERE c.is_unified=0
      ORDER BY m.created_at ASC, m.rowid ASC
    `).all();
    if (!unified && !messages.length) {
      db.exec('ROLLBACK');
      return null;
    }

    if (!unified) {
      const id = newId();
      const now = nowIso();
      db.prepare(`INSERT INTO conversations (id,title,created_at,updated_at,is_unified) VALUES (?,?,?,?,1)`)
        .run(id, 'Chat unificado', now, now);
      unified = db.prepare('SELECT * FROM conversations WHERE id=?').get(id);
    }

    const insert = db.prepare(`
      INSERT OR IGNORE INTO messages
        (id,conversation_id,role,content,created_at,model,provider,error,source_conversation_title,origin_message_id)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `);
    let importedCount = 0;
    const sourceIds = new Set();
    for (const message of messages) {
      const result = insert.run(
        newId(), unified.id, message.role, message.content, message.created_at,
        message.model, message.provider, message.error, message.source_conversation_title, message.id,
      );
      importedCount += result.changes;
      if (result.changes) sourceIds.add(message.conversation_id);
    }
    if (importedCount) db.prepare('UPDATE conversations SET updated_at=? WHERE id=?').run(nowIso(), unified.id);
    db.prepare('UPDATE conversations SET archived=0 WHERE id=?').run(unified.id);
    db.exec('COMMIT');
    return {
      conversation: db.prepare('SELECT * FROM conversations WHERE id=?').get(unified.id),
      importedCount,
      sourceCount: sourceIds.size,
    };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function deleteMessages(conversationId) {
  const db = getDb();
  db.prepare('DELETE FROM messages WHERE conversation_id=?').run(conversationId);
}

export function searchMessages(q, limit = 50) {
  const db = getDb();
  const like = likePattern(q);
  return db.prepare("SELECT m.*, c.title FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE m.content LIKE ? ESCAPE '\\' ORDER BY m.created_at DESC, m.rowid DESC LIMIT ?").all(like, limit);
}

// Escapa % _ e \ para que a busca trate o texto digitado literalmente.
function likePattern(text) {
  return '%' + String(text).replace(/[\\%_]/g, '\\$&') + '%';
}
