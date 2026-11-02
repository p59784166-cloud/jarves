import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarves-image-gen-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.UPLOAD_DIR = path.join(tmpDir, 'uploads');
process.env.NODE_ENV = 'test';
process.env.AI_PROVIDER = 'mock';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4xkAAAAASUVORK5CYII=';
let server, engine, baseUrl, engineUrl, receivedPrompt;

before(async () => {
  engine = http.createServer(async (req, res) => {
    if (req.url === '/sdapi/v1/options' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sd_model_checkpoint: 'test-model.safetensors' }));
      return;
    }
    if (req.url === '/sdapi/v1/txt2img' && req.method === 'POST') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      receivedPrompt = JSON.parse(raw);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ images: [png] }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  engine.listen(0, '127.0.0.1');
  await new Promise(resolve => engine.once('listening', resolve));
  engineUrl = `http://127.0.0.1:${engine.address().port}`;

  const mod = await import('../../backend/server.mjs');
  server = mod.startServer(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  await fetch(baseUrl + '/api/settings/image_gen_url', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: engineUrl }),
  });
});

after(() => {
  server?.close();
  engine?.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('image generator setting rejects public endpoints', async () => {
  const response = await fetch(baseUrl + '/api/settings/image_gen_url', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: 'http://example.com:7860' }),
  });
  assert.equal(response.status, 400);
});

test('local image generator status and PNG generation work', async () => {
  const statusResponse = await fetch(baseUrl + '/api/images/status');
  assert.equal(statusResponse.status, 200);
  const status = await statusResponse.json();
  assert.equal(status.available, true);
  assert.equal(status.model, 'test-model.safetensors');

  const response = await fetch(baseUrl + '/api/images/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'Uma paisagem montanhosa ao amanhecer', width: 768, height: 768, steps: 20 }),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.image, png);
  assert.equal(result.model, 'test-model.safetensors');
  assert.equal(receivedPrompt.prompt, 'Uma paisagem montanhosa ao amanhecer');
  assert.equal(receivedPrompt.width, 768);
  assert.equal(receivedPrompt.save_images, false);
});

test('image generation rejects empty prompts and unsupported resolutions', async () => {
  for (const payload of [{ prompt: '' }, { prompt: 'paisagem', width: 640 }]) {
    const response = await fetch(baseUrl + '/api/images/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(response.status, 400);
  }
});
