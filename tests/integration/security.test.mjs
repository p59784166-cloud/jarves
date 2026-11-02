import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jerver-sec-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.UPLOAD_DIR = path.join(tmpDir, 'uploads');
process.env.NODE_ENV = 'test';
process.env.AI_PROVIDER = 'mock';

let server, baseUrl;
before(async () => {
  const mod = await import('../../backend/server.mjs');
  server = mod.startServer(0, '127.0.0.1');
  await new Promise(res => server.on('listening', res));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(() => server?.close());

test('invalid JSON returns error not crash', async () => {
  const r = await fetch(baseUrl + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
  assert.ok(r.status >= 400);
});

test('missing message returns 400', async () => {
  const r = await fetch(baseUrl + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
  assert.equal(r.status, 400);
});

test('path traversal in file name rejected', async () => {
  const b64 = Buffer.from('x').toString('base64');
  const r = await fetch(baseUrl + '/api/files/upload', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '../evil.txt', mime: 'text/plain', data: b64 }),
  });
  assert.equal(r.status, 400);
});

test('arquivo grande (11 MB) e aceito: o limite padrao agora e 512 MB', async () => {
  const big = Buffer.alloc(11 * 1024 * 1024).toString('base64');
  const r = await fetch(baseUrl + '/api/files/upload', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'big.txt', mime: 'text/plain', data: big }),
  });
  assert.equal(r.status, 201);
});

test('settings disallowed key rejected', async () => {
  const r = await fetch(baseUrl + '/api/settings/evil_key', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: 'x' }),
  });
  assert.equal(r.status, 400);
});

test('nonexistent conversation 404', async () => {
  const r = await fetch(baseUrl + '/api/conversations/does-not-exist');
  assert.equal(r.status, 404);
});

test('delete conversation requires id', async () => {
  const r = await fetch(baseUrl + '/api/conversations/nope', { method: 'DELETE' });
  assert.equal(r.status, 404);
});
