import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jerver-test-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.MEMORY_ENABLED = 'true';
process.env.MEMORY_MAX_ITEMS = '10';

test('memory create/search/delete', async () => {
  const M = await import('../../database/repositories/memoryRepository.mjs');
  const m = M.createMemory({ kind: 'note', subject: 'foo', content: 'bar baz' });
  assert.ok(m.id);
  const list = M.listMemories();
  assert.ok(list.length >= 1);
  const found = M.searchMemories('baz');
  assert.ok(found.length >= 1);
  const ok = M.deleteMemory(m.id);
  assert.equal(ok, true);
});

test('memory limit enforced', async () => {
  // env already loaded with MEMORY_MAX_ITEMS=10
  const M = await import('../../database/repositories/memoryRepository.mjs');
  M.clearMemories();
  for (let i = 0; i < 10; i++) M.createMemory({ content: 'x' + i });
  assert.throws(() => M.createMemory({ content: 'overflow' }), /Limite/);
});
