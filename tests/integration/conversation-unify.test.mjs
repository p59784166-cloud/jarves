import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarves-unified-chat-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.UPLOAD_DIR = path.join(tmpDir, 'uploads');
process.env.NODE_ENV = 'test';
process.env.AI_PROVIDER = 'mock';

let server, baseUrl;
before(async () => {
  const mod = await import('../../backend/server.mjs');
  server = mod.startServer(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server?.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function createConversation(title, messages) {
  const response = await fetch(baseUrl + '/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  const conversation = await response.json();
  for (const message of messages) {
    await fetch(`${baseUrl}/api/conversations/${conversation.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });
  }
  return conversation;
}

test('unify reports when there is no history to combine', async () => {
  const response = await fetch(baseUrl + '/api/conversations/unify', { method: 'POST' });
  assert.equal(response.status, 400);
});

test('unify copies all history with source labels, preserves originals, and imports new messages only once', async () => {
  const first = await createConversation('Primeiro chat', [
    { role: 'user', content: 'Pedido inicial' },
    { role: 'assistant', content: 'Resposta inicial', model: 'modelo-teste' },
  ]);
  const second = await createConversation('Segundo chat', [
    { role: 'user', content: 'Outro pedido' },
  ]);

  const mergedResponse = await fetch(baseUrl + '/api/conversations/unify', { method: 'POST' });
  assert.equal(mergedResponse.status, 200);
  const merged = await mergedResponse.json();
  assert.equal(merged.importedCount, 3);
  assert.equal(merged.sourceCount, 2);
  assert.equal(merged.conversation.is_unified, 1);

  const historyResponse = await fetch(`${baseUrl}/api/conversations/${merged.conversation.id}`);
  const history = await historyResponse.json();
  assert.deepEqual(history.messages.map(message => message.content), ['Pedido inicial', 'Resposta inicial', 'Outro pedido']);
  assert.equal(history.messages[0].source_conversation_title, 'Primeiro chat');
  assert.equal(history.messages[2].source_conversation_title, 'Segundo chat');
  assert.equal(history.messages[1].model, 'modelo-teste');

  const repeat = await (await fetch(baseUrl + '/api/conversations/unify', { method: 'POST' })).json();
  assert.equal(repeat.conversation.id, merged.conversation.id);
  assert.equal(repeat.importedCount, 0);

  const originalResponse = await fetch(`${baseUrl}/api/conversations/${first.id}`);
  const original = await originalResponse.json();
  assert.equal(original.messages.length, 2);
  assert.equal(original.messages[0].content, 'Pedido inicial');

  await createConversation('Novo chat', [{ role: 'user', content: 'Mensagem posterior' }]);
  const updated = await (await fetch(baseUrl + '/api/conversations/unify', { method: 'POST' })).json();
  assert.equal(updated.conversation.id, merged.conversation.id);
  assert.equal(updated.importedCount, 1);
  const updatedHistory = await (await fetch(`${baseUrl}/api/conversations/${merged.conversation.id}`)).json();
  assert.equal(updatedHistory.messages.length, 4);
});
