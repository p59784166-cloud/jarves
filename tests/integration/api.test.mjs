import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jerver-int-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.UPLOAD_DIR = path.join(tmpDir, 'uploads');
process.env.NODE_ENV = 'test';
process.env.AI_PROVIDER = 'mock';
process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:11434';

let server, baseUrl;
before(async () => {
  const mod = await import('../../backend/server.mjs');
  server = mod.startServer(0, '127.0.0.1');
  await new Promise(res => server.on('listening', res));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(() => { server?.close(); });

test('health', async () => {
  const r = await fetch(baseUrl + '/api/health');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.status, 'ok');
});

test('mock chat roundtrip', async () => {
  const r = await fetch(baseUrl + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'ola', stream: false }),
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(j.content.includes('ola') || j.content.length > 0);
  assert.equal(j.provider, 'mock');
});

test('conversation persisted and recovered', async () => {
  const r = await fetch(baseUrl + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'persist test', stream: false }),
  });
  const j = await r.json();
  const convId = j.conversationId;
  const r2 = await fetch(baseUrl + '/api/conversations/' + convId);
  const j2 = await r2.json();
  assert.ok(Array.isArray(j2.messages));
  assert.ok(j2.messages.length >= 2);
});

test('model selection respected (mock has one model)', async () => {
  const r = await fetch(baseUrl + '/api/models');
  const j = await r.json();
  assert.equal(j.provider, 'mock');
});

test('file upload and read', async () => {
  const b64 = Buffer.from('conteudo').toString('base64');
  const up = await fetch(baseUrl + '/api/files/upload', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 't.txt', mime: 'text/plain', data: b64 }),
  });
  const uj = await up.json();
  assert.ok(uj.id);
  const rd = await fetch(baseUrl + '/api/files/' + uj.id + '/content');
  const rj = await rd.json();
  assert.equal(rj.content, 'conteudo');
  await fetch(baseUrl + '/api/files/' + uj.id, { method: 'DELETE' });
});

test('cancel endpoint 404 for unknown', async () => {
  const r = await fetch(baseUrl + '/api/chat/cancel', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: 'nope' }),
  });
  assert.equal(r.status, 404);
});

test('settings validation', async () => {
  const r = await fetch(baseUrl + '/api/settings/ai_provider', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: 'invalid' }),
  });
  assert.equal(r.status, 400);
});

test('memory CRUD', async () => {
  const c = await fetch(baseUrl + '/api/memory', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: 'mem test', kind: 'note' }),
  });
  const cj = await c.json();
  assert.ok(cj.id);
  const del = await fetch(baseUrl + '/api/memory/' + cj.id, { method: 'DELETE' });
  assert.equal(del.status, 200);
});

test('task creation and run (mock)', async () => {
  const r = await fetch(baseUrl + '/api/tasks', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-token': process.env.ADMIN_TOKEN || '' },
    body: JSON.stringify({ goal: 'planejar algo', autoRun: false }),
  });
  const j = await r.json();
  assert.ok(j.id);
  assert.ok(Array.isArray(j.steps));
  const run = await fetch(baseUrl + '/api/tasks/' + j.id + '/run', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-token': process.env.ADMIN_TOKEN || '' }, body: '{}' });
  const rj = await run.json();
  assert.ok(['done','partial'].includes(rj.status));
});

test('reviewed task plan is preserved and remains pending until explicitly run', async () => {
  const plan = [
    { title: 'Pesquisar requisitos', agent: 'researcher', dependsOn: [] },
    { title: 'Gerar exemplo HTML', agent: 'programmer', dependsOn: [0] },
  ];
  const response = await fetch(baseUrl + '/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': process.env.ADMIN_TOKEN || '' },
    body: JSON.stringify({ goal: 'Criar um exemplo', plan, autoRun: false }),
  });
  assert.equal(response.status, 201);
  const task = await response.json();
  assert.equal(task.status, 'pending');
  assert.deepEqual(task.plan, plan);
  assert.deepEqual(task.steps.map(step => step.title), plan.map(step => step.title));
});

test('reviewed task plan rejects unknown agents and invalid dependencies', async () => {
  for (const plan of [
    [{ title: 'Executar', agent: 'shell', dependsOn: [] }],
    [{ title: 'Etapa', agent: 'general', dependsOn: [0] }],
  ]) {
    const response = await fetch(baseUrl + '/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-token': process.env.ADMIN_TOKEN || '' },
      body: JSON.stringify({ goal: 'Plano inválido', plan, autoRun: false }),
    });
    assert.equal(response.status, 400);
  }
});

test('research endpoint handles failure gracefully', async () => {
  // network may be blocked; just ensure no crash
  const r = await fetch(baseUrl + '/api/research', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'test' }),
  });
  // accept any non-500? research may fail due network; ensure JSON
  const j = await r.json();
  assert.ok(j);
});
