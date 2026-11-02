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
  const mod = await import('./backend/server.mjs');
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
