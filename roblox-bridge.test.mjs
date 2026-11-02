import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarves-roblox-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.UPLOAD_DIR = path.join(tmpDir, 'uploads');
process.env.NODE_ENV = 'test';

let server;
let baseUrl;
let token;

before(async () => {
  const mod = await import('../../backend/server.mjs');
  server = mod.startServer(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/roblox`;
});

after(() => server?.close());

async function request(path, { method = 'GET', body, bridgeToken = token } = {}) {
  return fetch(baseUrl + path, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(bridgeToken ? { 'X-Jarves-Bridge-Token': bridgeToken } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test('pairing token is random and required for bridge access', async () => {
  const pair = await request('/pair', { method: 'POST', body: {} });
  assert.equal(pair.status, 200);
  const result = await pair.json();
  assert.equal(result.token.length, 64);
  assert.equal(result.expiresOnRestart, true);
  token = result.token;

  assert.equal((await request('/status', { bridgeToken: '' })).status, 403);
  const status = await request('/status');
  assert.equal(status.status, 200);
  assert.deepEqual(await status.json(), { ok: true, queued: 0 });
});

test('script queue validates target and source and waits for acknowledgment', async () => {
  const queued = await request('/queue', {
    method: 'POST',
    body: { name: 'Door Controller', target: 'ServerScriptService', source: 'print("hello")' },
  });
  assert.equal(queued.status, 201);
  const job = await queued.json();
  assert.equal(job.queued, 1);

  const next = await request('/next');
  const pending = (await next.json()).script;
  assert.equal(pending.id, job.id);
  assert.equal(pending.name, 'Door Controller');
  assert.equal(pending.className, 'Script');
  assert.equal(pending.source, 'print("hello")');

  assert.equal((await request('/queue', {
    method: 'POST',
    body: { name: 'bad', target: 'Workspace', source: 'print(1)' },
  })).status, 400);
  assert.equal((await request('/queue', {
    method: 'POST',
    body: { name: 'bad/name', target: 'ServerScriptService', source: 'print(1)' },
  })).status, 400);
  assert.equal((await request('/queue', {
    method: 'POST',
    body: { name: 'Empty', target: 'ServerScriptService', source: '  ' },
  })).status, 400);

  assert.equal((await request('/ack', { method: 'POST', body: { id: 'missing', action: 'inserted' } })).status, 404);
  const ack = await request('/ack', { method: 'POST', body: { id: job.id, action: 'inserted' } });
  assert.equal(ack.status, 200);
  assert.equal((await (await request('/next')).json()).script, null);
});

test('script queue enforces its payload size and pending-item limits', async () => {
  const tooLarge = await request('/queue', {
    method: 'POST',
    body: { name: 'Large', target: 'ServerScriptService', source: 'x'.repeat(64 * 1024 + 1) },
  });
  assert.equal(tooLarge.status, 413);

  for (let index = 0; index < 8; index++) {
    const response = await request('/queue', {
      method: 'POST',
      body: { name: `Queued ${index}`, target: 'ReplicatedStorage', source: 'return {}' },
    });
    assert.equal(response.status, 201);
  }
  const full = await request('/queue', {
    method: 'POST',
    body: { name: 'Overflow', target: 'ReplicatedStorage', source: 'return {}' },
  });
  assert.equal(full.status, 429);
});

test('rotating the pairing token invalidates old credentials and clears queued scripts', async () => {
  const firstPair = await request('/pair', { method: 'POST', body: {} });
  token = (await firstPair.json()).token;
  const queued = await request('/queue', {
    method: 'POST',
    body: { name: 'Pending', target: 'ReplicatedStorage', source: 'return {}' },
  });
  assert.equal(queued.status, 201);
  const previous = token;
  const pair = await request('/pair', { method: 'POST', body: {} });
  token = (await pair.json()).token;
  assert.notEqual(token, previous);
  assert.equal((await request('/status', { bridgeToken: previous })).status, 403);
  assert.equal((await (await request('/next')).json()).script, null);
});
