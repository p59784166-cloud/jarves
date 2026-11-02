import { test } from 'node:test';
import assert from 'node:assert/strict';

test('analyzeCode detects eval', async () => {
  const { analyzeCodeSnippet } = await import('../../backend/services/fileService.mjs');
  const r = analyzeCodeSnippet('eval("x")');
  assert.ok(r.issues.some(i => /eval/i.test(i.message)));
});

test('analyzeCode empty', async () => {
  const { analyzeCodeSnippet } = await import('../../backend/services/fileService.mjs');
  const r = analyzeCodeSnippet('');
  assert.equal(r.summary, 'Codigo vazio');
});
