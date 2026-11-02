import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarves-ai-'));
process.env.DB_PATH = path.join(tmp, 't.db'); process.env.NODE_ENV = 'test'; process.env.AI_PROVIDER = 'mock';
delete process.env.AI_QUALITY;

test('qualidade padrao nao corta a resposta em 128 tokens', async () => {
  const { getQualityOptions } = await import('../../backend/services/aiService.mjs');
  assert.ok(getQualityOptions().maxTokens >= 1024);
});
test('listAvailableModels informa o modelo configurado', async () => {
  const S = await import('../../database/repositories/settingsRepository.mjs');
  const { listAvailableModels } = await import('../../backend/services/aiService.mjs');
  S.setSetting('ai_provider', 'mock');
  const r = await listAvailableModels();
  assert.equal(r.provider, 'mock'); assert.ok(Array.isArray(r.models));
  assert.ok('selected' in r);
});
