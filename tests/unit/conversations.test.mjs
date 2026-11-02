import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jerver-conv-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');

test('conversation create/list/messages', async () => {
  const C = await import('../../database/repositories/conversationRepository.mjs');
  const c = C.createConversation({ title: 'T1' });
  assert.ok(c.id);
  C.addMessage({ conversationId: c.id, role: 'user', content: 'hi' });
  const msgs = C.listMessages(c.id);
  assert.equal(msgs.length, 1);
  const list = C.listConversations();
  assert.ok(list.find(x => x.id === c.id));
  const updated = C.updateConversation(c.id, { title: 'T2' });
  assert.equal(updated.title, 'T2');
  assert.equal(C.deleteConversation(c.id), true);
});
