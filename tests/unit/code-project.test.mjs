import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGeneratedCodeProject } from '../../frontend/scripts/codeProject.mjs';

test('code project parser accepts a multi-file starter project', () => {
  const project = parseGeneratedCodeProject(JSON.stringify({
    plan: ['Criar a entrada', 'Documentar o projeto'],
    files: [
      { name: 'main.py', content: 'print("hello")' },
      { name: 'README.md', content: '# Projeto\n\nExecute com Python.' },
    ],
  }), 'python');
  assert.equal(project.type, 'codigo');
  assert.equal(project.language, 'python');
  assert.equal(project.files.length, 2);
  assert.equal(project.files[0].mime, 'text/x-python');
});

test('code project parser accepts JSON code fences and auxiliary project files', () => {
  const project = parseGeneratedCodeProject('```json\n' + JSON.stringify({
    files: [
      { name: 'main.ts', content: 'const answer: number = 42;' },
      { name: 'package.json', content: '{"scripts":{"start":"node main.js"}}' },
    ],
  }) + '\n```', 'typescript');
  assert.equal(project.files[1].mime, 'application/json');
});

test('code project parser rejects unsafe names, wrong language extensions, duplicates, and oversized output', () => {
  const parse = files => parseGeneratedCodeProject(JSON.stringify({ files }), 'javascript');
  assert.throws(() => parse([{ name: '../main.js', content: 'console.log(1)' }]), /Nome de arquivo inválido/);
  assert.throws(() => parse([{ name: 'main.py', content: 'print(1)' }]), /não corresponde/);
  assert.throws(() => parse([
    { name: 'main.js', content: 'console.log(1)' },
    { name: 'MAIN.JS', content: 'console.log(2)' },
  ]), /duplicado/);
  assert.throws(() => parse([{ name: 'main.js', content: 'x'.repeat(100_001) }]), /excede 100 KB/);
});

test('code project parser rejects malformed model responses and non-text files', () => {
  assert.throws(() => parseGeneratedCodeProject('not JSON', 'python'), /manifesto JSON/);
  assert.throws(() => parseGeneratedCodeProject(JSON.stringify({
    files: [{ name: 'main.py', content: '' }],
  }), 'python'), /vazio/);
  assert.throws(() => parseGeneratedCodeProject(JSON.stringify({
    files: [{ name: 'main.py', content: 'print(1)', encoding: 'base64' }],
  }), 'python'), /texto UTF-8/);
});
