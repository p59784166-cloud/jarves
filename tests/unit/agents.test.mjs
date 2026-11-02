import { test } from 'node:test';
import assert from 'node:assert/strict';

test('selectAgentsForTask picks programmer for code', async () => {
  const { selectAgentsForTask } = await import('../../ai/agents/registry.mjs');
  const ids = selectAgentsForTask('corrigir bug no codigo javascript');
  assert.ok(ids.includes('programmer'));
});

test('createAgents returns 10', async () => {
  const { createAgents } = await import('../../ai/agents/registry.mjs');
  const agents = createAgents();
  assert.equal(agents.length, 10);
  assert.ok(agents.every(a => a.id && a.name && a.systemPrompt));
});
