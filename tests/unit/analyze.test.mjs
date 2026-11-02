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

test('JavaScript syntax diagnostics report a location without executing the source', async () => {
  const { analyzeCodeSnippet } = await import('../../backend/services/fileService.mjs');
  globalThis.__jarvesAnalyzeShouldNotRun = false;
  const result = analyzeCodeSnippet('const value = ;\nglobalThis.__jarvesAnalyzeShouldNotRun = true;', 'javascript');
  assert.equal(result.syntaxCheck, 'failed');
  assert.equal(result.issues[0].line, 1);
  assert.ok(result.issues[0].column > 0);
  assert.equal(globalThis.__jarvesAnalyzeShouldNotRun, false);
  delete globalThis.__jarvesAnalyzeShouldNotRun;
});

test('balanced punctuation inside JavaScript strings is not reported as a syntax error', async () => {
  const { analyzeCodeSnippet } = await import('../../backend/services/fileService.mjs');
  const result = analyzeCodeSnippet('const example = "(((((((((";', 'javascript');
  assert.equal(result.syntaxCheck, 'passed');
  assert.equal(result.issues.length, 0);
});

test('JSON syntax diagnostics report the invalid character location', async () => {
  const { analyzeCodeSnippet } = await import('../../backend/services/fileService.mjs');
  const result = analyzeCodeSnippet('{\n  "name":,\n}', 'json');
  assert.equal(result.syntaxCheck, 'failed');
  assert.equal(result.issues[0].line, 2);
  assert.ok(result.issues[0].column > 0);
});

test('unsupported languages are identified instead of claiming syntax validation', async () => {
  const { analyzeCodeSnippet } = await import('../../backend/services/fileService.mjs');
  const result = analyzeCodeSnippet('print("hello")', 'python');
  assert.equal(result.syntaxCheck, 'not-checked');
  assert.match(result.summary, /sintaxe nao validada/);
});
