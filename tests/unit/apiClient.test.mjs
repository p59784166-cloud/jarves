import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const source = fs.readFileSync(path.resolve('frontend/scripts/api.js'), 'utf8');
function loadApi(fetchImpl, protocol = 'http:', origin = 'http://localhost:3000') {
  const window = {};
  const context = { window, location: { protocol, origin }, fetch: fetchImpl, encodeURIComponent, String, Error, JSON };
  vm.runInNewContext(source, context);
  return window;
}

test('API client envia JSON e codifica IDs de recursos', async () => {
  let seen;
  const w = loadApi(async (url, options) => {
    seen = { url, options };
    return { ok: true, status: 200, text: async () => '{"ok":true}' };
  });
  const result = await w.api.updateConversation('id/com espaço', { title: 'Teste' });
  assert.equal(result.ok, true);
  assert.equal(seen.url, '/api/conversations/id%2Fcom%20espa%C3%A7o');
  assert.equal(seen.options.headers['Content-Type'], 'application/json');
  assert.equal(seen.options.body, '{"title":"Teste"}');
});

test('API client mostra origem real em falha de rede', async () => {
  const w = loadApi(async () => { throw new TypeError('NetworkError when attempting to fetch resource'); }, 'http:', 'http://192.168.0.20:3000');
  await assert.rejects(w.api.health(), /http:\/\/192\.168\.0\.20:3000/);
});

test('API client explica bloqueio ao abrir via file://', async () => {
  const w = loadApi(async () => { throw new TypeError('Failed to fetch'); }, 'file:', 'null');
  await assert.rejects(w.api.health(), /aberto como arquivo/);
});

test('API client preserva mensagens de erro HTTP do backend', async () => {
  const w = loadApi(async () => ({ ok: false, status: 503, statusText: 'Service Unavailable', text: async () => '{"error":"Modelo local indisponível"}' }));
  await assert.rejects(w.api.health(), /Modelo local indisponível/);
});
