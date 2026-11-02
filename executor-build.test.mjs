import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('JARVES_EXECUTOR.html e gerado como arquivo unico, sem referencias externas', () => {
  execFileSync(process.execPath, [path.join(root, 'scripts/build-executor.mjs')], { stdio: 'pipe' });
  const html = fs.readFileSync(path.resolve(root, '..', 'JARVES_EXECUTOR.html'), 'utf8');
  assert.ok(!/(src|href)="\/(scripts|styles|assets|manifest)/.test(html), 'nao pode apontar para arquivos externos');
  assert.ok(html.includes('jarves-executor'), 'backend de navegador embutido');
  assert.ok(html.includes('id="chatArea"'), 'interface embutida');
  // Includes generated preview scripts as strings embedded in the base engine.
  assert.equal((html.match(/<script>/g) || []).length, 19);
  assert.ok(html.includes('JARVES_BASE'), 'IA base embutida');
});

test('backend de navegador tem sintaxe valida', () => {
  execFileSync(process.execPath, ['--check', path.join(root, 'executor/browser-backend.js')]);
});
