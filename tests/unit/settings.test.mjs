import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jerver-set-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');

test('settings get/set', async () => {
  const S = await import('../../database/repositories/settingsRepository.mjs');
  S.setSetting('foo', 'bar');
  assert.equal(S.getSetting('foo'), 'bar');
  assert.equal(S.getAllSettings().foo, 'bar');
  assert.equal(S.deleteSetting('foo'), true);
});

test('API key is encrypted at rest and remains readable by the AI runtime', async () => {
  const S = await import('../../database/repositories/settingsRepository.mjs');
  const { getDb } = await import('../../backend/services/db.mjs');
  const secret = 'jarves-test-secret-123456';
  S.setSetting('openai_api_key', secret);
  const stored = getDb().prepare('SELECT value FROM settings WHERE key=?').get('openai_api_key').value;
  assert.match(stored, /^enc:v1:/);
  assert.notEqual(stored, secret);
  assert.equal(S.getSetting('openai_api_key'), secret);
  assert.equal(S.getAllSettings().openai_api_key, secret);
  S.deleteSetting('openai_api_key');
});
