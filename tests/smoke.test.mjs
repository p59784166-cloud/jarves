import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('health endpoint starts and reports database status', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarves-test-'));
  process.env.DB_PATH = path.join(tmp, 'jarves.db');
  process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
  process.env.NODE_ENV = 'test';
  const { startServer } = await import('../backend/server.mjs');
  const { closeDb } = await import('../backend/services/db.mjs');
  const server = startServer(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    closeDb();
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/health`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.db, true);
  assert.equal(typeof body.version, 'string');
});

test('PWA manifest and HTML test suite are present', () => {
  const root = path.resolve('.');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'frontend/manifest.json'), 'utf8'));
  assert.equal(manifest.name, 'JARVES AI');
  assert.ok(fs.existsSync(path.join(root, 'frontend/scripts/html-tests.js')));
  assert.ok(fs.existsSync(path.join(root, 'frontend/index.html')));
  const serviceWorker = fs.readFileSync(path.join(root, 'frontend/sw.js'), 'utf8');
  assert.match(serviceWorker, /scripts\/html-tests\.js/);
});
