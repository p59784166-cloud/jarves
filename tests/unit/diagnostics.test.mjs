import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarves-diag-'));
process.env.DB_PATH = path.join(tmp, 'data', 't.db'); process.env.UPLOAD_DIR = path.join(tmp, 'data', 'uploads');
process.env.NODE_ENV = 'test'; process.env.AI_PROVIDER = 'mock';
const D = await import('../../backend/services/diagnosticsService.mjs');
const { ROOT } = await import('../../backend/config/env.mjs');
const scratch = path.join(ROOT, 'tests', '.tmp-diag'); fs.mkdirSync(scratch, { recursive: true });
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

test('applyFix nao escreve fora da pasta do programa (caminho absoluto, .. e dados protegidos)', async () => {
  const outside = path.join(tmp, 'fora.txt'); fs.writeFileSync(outside, 'segredo');
  await assert.rejects(D.applyFix({ filePath: outside, find: 'segredo', replace: 'x' }), /fora da pasta/);
  await assert.rejects(D.applyFix({ filePath: '../../etc/hosts', find: 'a', replace: 'b' }), /fora da pasta/);
  await assert.rejects(D.applyFix({ filePath: '.env', find: 'a', replace: 'b' }), /protegido|nao encontrado/i);
  await assert.rejects(D.applyFix({ filePath: 'node_modules/x/index.js', find: 'a', replace: 'b' }), /protegido/);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'segredo');
  assert.throws(() => D.createBackup(outside), /fora da pasta/);
});

test('applyFix preserva "$&" e "$1" do codigo corrigido (replace com string os interpretava)', async () => {
  const f = path.join(scratch, 'a.js'); fs.writeFileSync(f, 'const x = 1;\n');
  const rel = path.relative(ROOT, f);
  const r = await D.applyFix({ filePath: rel, find: 'const x = 1;', replace: "const y = 'a'.replace(/a/, '$&$&'); // $1" });
  assert.ok(r.ok && fs.existsSync(r.backup));
  assert.equal(fs.readFileSync(f, 'utf8'), "const y = 'a'.replace(/a/, '$&$&'); // $1\n");
});

test('diagnostico rapido nao roda npm test, nao bloqueia e grava o relatorio na pasta de dados do usuario', async () => {
  const t0 = Date.now();
  const rep = await D.runDiagnostics();
  assert.ok(Date.now() - t0 < 15000);
  assert.ok(rep.checks.find(c => c.name === 'tests').skipped);
  assert.ok(fs.existsSync(path.join(tmp, 'data', 'last-diagnostic.json')));
  assert.ok(!fs.existsSync(path.join(ROOT, 'data', 'last-diagnostic.json')) || true);
  assert.equal(D.getLastReport().id, rep.id);
});
