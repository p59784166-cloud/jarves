import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarves-sec-'));
process.env.DB_PATH = path.join(tmp, 't.db'); process.env.NODE_ENV = 'test';

test('perder o .jarves-secret nao derruba configuracoes nem o chat', async () => {
  const S = await import('../../database/repositories/settingsRepository.mjs');
  S.setSetting('ollama_model', 'm1');
  S.setSetting('openai_api_key', 'sk-test-123456');
  assert.equal(S.getSetting('openai_api_key'), 'sk-test-123456');
  // simula troca/perda da chave local: grava lixo cifrado de outra chave
  const { getDb } = await import('../../backend/services/db.mjs');
  const other = await import('node:crypto');
  const iv = other.randomBytes(12); const c = other.createCipheriv('aes-256-gcm', other.randomBytes(32), iv);
  const enc = Buffer.concat([c.update('x'), c.final()]);
  getDb().prepare('UPDATE settings SET value=? WHERE key=?').run('enc:v1:' + Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64'), 'openai_api_key');
  assert.equal(S.getSetting('openai_api_key'), null);          // antes: lancava excecao
  const all = S.getAllSettings();                               // antes: lancava excecao
  assert.equal(all.ollama_model, 'm1');
  assert.ok(!('openai_api_key' in all));
});
