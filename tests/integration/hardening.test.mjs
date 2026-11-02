import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Cobre as correcoes de seguranca/rotas da 2.3.0 contra o servidor Express real.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarves-hard-'));
Object.assign(process.env, {
  DB_PATH: path.join(tmpDir, 'test.db'), UPLOAD_DIR: path.join(tmpDir, 'uploads'),
  NODE_ENV: 'test', AI_PROVIDER: 'mock', ADMIN_TOKEN: 'segredo-teste', CORS_ORIGIN: 'http://app.test', MAX_UPLOAD_BYTES: '1000',
});
delete process.env.RESEARCH_ENABLED;

let server, base;
before(async () => {
  const mod = await import('../../backend/server.mjs');
  server = mod.startServer(0, '127.0.0.1');
  await new Promise(res => server.on('listening', res));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server?.close());
const j = (method, url, body, headers = {}) => fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });

test('GET /api/memory/search e /status nao sao capturadas por /:id', async () => {
  await j('POST', '/api/memory', { content: 'gosto de cafe' });
  const r = await j('GET', '/api/memory/search?q=cafe');
  assert.equal(r.status, 200);
  assert.equal((await r.json()).length, 1);
  assert.equal((await j('GET', '/api/memory/status')).status, 200);
});

test('/api/diagnostics/fix exige ADMIN_TOKEN no header e recusa caminhos fora do programa', async () => {
  const body = { filePath: '/etc/hosts', find: 'a', replace: 'b' };
  assert.equal((await j('POST', '/api/diagnostics/fix', body)).status, 403);
  assert.equal((await j('POST', '/api/diagnostics/fix?admin_token=segredo-teste', body)).status, 403); // token na URL nao vale
  const r = await j('POST', '/api/diagnostics/fix', body, { 'x-admin-token': 'segredo-teste' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /fora da pasta/);
});

test('preview de arquivo enviado usa CSP sandbox e preview inexistente da 404', async () => {
  const up = await (await j('POST', '/api/files/upload', { name: 's.html', mime: 'text/html', data: Buffer.from('<h1>oi</h1>').toString('base64') })).json();
  const r = await fetch(`${base}/preview/${up.id}`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /^sandbox allow-scripts/);
  assert.equal((await fetch(`${base}/preview/nao-existe`)).status, 404);
});

test('download de rede rejeita enderecos locais e exporta arquivos sem alterar bytes', async () => {
  const local = await j('POST', '/api/files/download', { url: 'http://127.0.0.1:3000/arquivo.pdf' });
  assert.equal(local.status, 400);
  assert.match((await local.json()).error, /endereços públicos/);
  assert.equal((await j('POST', '/api/files/download', { url: 'http://localhost:3000/arquivo.pdf' })).status, 400);
  const invalidScheme = await j('POST', '/api/files/download', { url: 'file:///etc/passwd' });
  assert.equal(invalidScheme.status, 400);

  const bytes = Buffer.from([0, 1, 2, 255, 254]);
  const uploaded = await j('POST', '/api/files/upload', {
    name: 'arquivo.bin', mime: 'application/octet-stream', data: bytes.toString('base64'),
  });
  const record = await uploaded.json();
  const download = await fetch(`${base}/api/files/${record.id}/download`);
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-disposition'), /filename="arquivo.bin"/);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
});

test('upload: base64 invalido = 400; acima do limite = 413; nome com ".." no meio e aceito', async () => {
  assert.equal((await j('POST', '/api/files/upload', { name: 'x.txt', data: '%%%' })).status, 400);
  assert.equal((await j('POST', '/api/files/upload', { name: 'x.txt', data: Buffer.from('x'.repeat(5000)).toString('base64') })).status, 413);
  assert.equal((await j('POST', '/api/files/upload', { name: 'a..b.txt', data: Buffer.from('oi').toString('base64') })).status, 201);
});

test('configuracoes: valor vazio limpa a configuracao em vez de falhar', async () => {
  for (const key of ['ai_timeout_ms', 'ai_quality', 'ai_provider']) assert.equal((await j('PUT', `/api/settings/${key}`, { value: '' })).status, 200);
});

test('pesquisa web vem desativada por padrao', async () => {
  assert.equal((await j('POST', '/api/research', { query: 'x' })).status, 403);
});

test('chat: requestId duplicado = 409 sem gravar mensagem; conversa inexistente = 404', async () => {
  const first = j('POST', '/api/chat', { message: 'primeira', requestId: 'dup-1', stream: false });
  await new Promise(r => setTimeout(r, 15));
  assert.equal((await j('POST', '/api/chat', { message: 'segunda', requestId: 'dup-1' })).status, 409);
  const conv = (await (await first).json()).conversationId;
  const msgs = await (await j('GET', `/api/conversations/${conv}/messages`)).json();
  assert.equal(msgs.filter(m => m.role === 'user').length, 1);
  assert.equal((await j('POST', '/api/chat', { message: 'x', conversationId: 'nao-existe' })).status, 404);
});

test('CORS so responde para a origem configurada', async () => {
  const ok = await fetch(base + '/api/health', { headers: { Origin: 'http://app.test' } });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'http://app.test');
  const bad = await fetch(base + '/api/health', { headers: { Origin: 'http://evil.test' } });
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
});

test('tarefa com agente escolhido usa exatamente esse agente', async () => {
  const r = await j('POST', '/api/tasks', { goal: 'revisar codigo', agentId: 'reviewer' }, { 'x-admin-token': 'segredo-teste' });
  assert.equal(r.status, 201);
  const t = await r.json();
  assert.equal(t.steps.length, 1);
  assert.equal(t.steps[0].agent_id, 'reviewer');
});
