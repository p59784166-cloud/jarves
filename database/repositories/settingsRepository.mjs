import { getDb } from '../../backend/services/db.mjs';
import { nowIso } from '../../backend/services/id.mjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { env, resolvePath } from '../../backend/config/env.mjs';

const SECRET_KEY_NAME = 'openai_api_key';
let encryptionKey;
function getEncryptionKey() {
  if (encryptionKey) return encryptionKey;
  const keyPath = path.join(path.dirname(resolvePath(env.DB_PATH)), '.jarves-secret');
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  try { encryptionKey = fs.readFileSync(keyPath); }
  catch {
    encryptionKey = crypto.randomBytes(32);
    try { fs.writeFileSync(keyPath, encryptionKey, { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; encryptionKey = fs.readFileSync(keyPath); }
    try { fs.chmodSync(keyPath, 0o600); } catch {}
  }
  if (encryptionKey.length !== 32) throw new Error('Chave local de proteção inválida.');
  return encryptionKey;
}
function protectSecret(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return `enc:v1:${Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64')}`;
}
let warnedUnreadable = false;
function revealSecret(value) {
  if (!value || !String(value).startsWith('enc:v1:')) return value; // supports migration from earlier plaintext settings
  // Se o arquivo .jarves-secret foi perdido/trocado, a chave nao pode ser lida. Antes isso lancava
  // excecao e derrubava /api/settings e TODO o chat (500). Agora a chave e tratada como ausente.
  try {
    const payload = Buffer.from(String(value).slice(7), 'base64');
    if (payload.length < 29) throw new Error('payload curto');
    const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), payload.subarray(0, 12));
    decipher.setAuthTag(payload.subarray(12, 28));
    return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    if (!warnedUnreadable) { warnedUnreadable = true; console.warn('[JARVES] API key salva nao pode ser decifrada (arquivo .jarves-secret ausente ou diferente). Cadastre a chave novamente.'); }
    return null;
  }
}

export function getSetting(key, def = null) {
  const db = getDb();
  const r = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  if (!r) return def;
  if (key === SECRET_KEY_NAME) {
    const secret = revealSecret(r.value);
    if (secret && !String(r.value).startsWith('enc:v1:')) {
      const now = nowIso();
      db.prepare('UPDATE settings SET value=?,updated_at=? WHERE key=?').run(protectSecret(secret), now, key);
    }
    return secret;
  }
  return r.value;
}

export function setSetting(key, value) {
  const db = getDb();
  const now = nowIso();
  const exists = db.prepare('SELECT 1 FROM settings WHERE key=?').get(key);
  const stored = key === SECRET_KEY_NAME ? protectSecret(value) : String(value);
  if (exists) db.prepare('UPDATE settings SET value=?,updated_at=? WHERE key=?').run(stored, now, key);
  else db.prepare('INSERT INTO settings (key,value,updated_at) VALUES (?,?,?)').run(key, stored, now);
  return getSetting(key);
}

export function getAllSettings() {
  const db = getDb();
  const rows = db.prepare('SELECT key,value FROM settings').all();
  const out = {};
  for (const r of rows) {
    const v = r.key === SECRET_KEY_NAME ? revealSecret(r.value) : r.value;
    if (v !== null) out[r.key] = v;
  }
  return out;
}

export function deleteSetting(key) {
  const db = getDb();
  return db.prepare('DELETE FROM settings WHERE key=?').run(key).changes > 0;
}
