import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarves-repo-'));
process.env.DB_PATH = path.join(tmp, 't.db'); process.env.NODE_ENV = 'test';

test('mensagens criadas no mesmo milissegundo mantem a ordem de insercao', async () => {
  const CR = await import('../../database/repositories/conversationRepository.mjs');
  const c = CR.createConversation({ title: 't' });
  const RealDate = Date; const fixed = new RealDate().toISOString();
  const { getDb } = await import('../../backend/services/db.mjs');
  for (let i = 0; i < 30; i++) {
    getDb().prepare('INSERT INTO messages (id,conversation_id,role,content,created_at) VALUES (?,?,?,?,?)').run('id-' + Math.random(), c.id, i % 2 ? 'assistant' : 'user', 'm' + i, fixed);
  }
  assert.deepEqual(CR.listMessages(c.id).map(m => m.content), Array.from({ length: 30 }, (_, i) => 'm' + i));
});

test('busca trata % e _ literalmente', async () => {
  const CR = await import('../../database/repositories/conversationRepository.mjs');
  const a = CR.createConversation({ title: 'desconto 50% hoje' });
  CR.createConversation({ title: 'desconto 500 hoje' });
  CR.createConversation({ title: 'ab_c' }); CR.createConversation({ title: 'abxc' });
  assert.deepEqual(CR.listConversations({ search: '50%' }).map(x => x.id), [a.id]);
  assert.equal(CR.listConversations({ search: 'ab_c' }).length, 1);
  assert.equal(CR.searchMessages('%').length, 0);
});

test('PATCH aceita agentId (camelCase) e agent_id', async () => {
  const CR = await import('../../database/repositories/conversationRepository.mjs');
  const c = CR.createConversation({ title: 'x' });
  assert.equal(CR.updateConversation(c.id, { agentId: 'programmer' }).agent_id, 'programmer');
  assert.equal(CR.updateConversation(c.id, { agent_id: 'general' }).agent_id, 'general');
});

test('memoria: kind nulo vira note, conteudo vazio e rejeitado, busca com caracteres especiais nao quebra', async () => {
  const M = await import('../../database/repositories/memoryRepository.mjs');
  assert.equal(M.createMemory({ kind: null, content: 'gosto de cafe' }).kind, 'note');
  assert.throws(() => M.createMemory({ content: '   ' }), /vazio/);
  assert.equal(M.searchMemories('cafe').length, 1);
  assert.doesNotThrow(() => M.searchMemories('"cafe -(:'));
  assert.equal(M.searchMemories('100%').length, 0);
});
