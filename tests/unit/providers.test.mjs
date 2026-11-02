import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
let server, base, mode = 'ok';
const { OllamaProvider } = await import('../../ai/providers/ollama.mjs');
const { OpenAICompatibleProvider } = await import('../../ai/providers/openaiCompatible.mjs');

before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      if (req.url === '/api/tags') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ models: [{ name: 'm1', size: 5 }] })); }
      if (req.url === '/v1/models') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ data: [{ id: 'gpt-6.1-sol' }] })); }
      if (req.url === '/api/chat') {
        const stream = JSON.parse(body).stream;
        if (mode === 'hang') return; // nunca responde: testa timeout
        if (!stream) { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ message: { content: 'oi' }, model: 'm1', done: true })); }
        res.setHeader('Content-Type', 'application/x-ndjson');
        res.write(JSON.stringify({ model: 'm1', message: { content: 'Ol' }, done: false }) + '\n');
        if (mode === 'error') { res.write(JSON.stringify({ error: 'model not found' }) + '\n'); return res.end(); }
        res.write(JSON.stringify({ model: 'm1', message: { content: 'a' }, done: false }) + '\n');
        // ultima linha SEM \n e com done:true e conteudo vazio (formato real do Ollama)
        return res.end(JSON.stringify({ model: 'm1', message: { content: '' }, done: true }));
      }
      if (req.url === '/v1/chat/completions') {
        res.setHeader('Content-Type', 'text/event-stream');
        res.write('data: ' + JSON.stringify({ model: 'gpt-x', choices: [{ delta: { content: 'Ola ' } }] }) + '\n\n');
        res.write('data: ' + JSON.stringify({ model: 'gpt-x', choices: [{ delta: { content: 'mundo' } }] }) + '\n\n');
        return res.end('data: [DONE]\n\n');
      }
      res.statusCode = 404; res.end();
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function collect(it) { const out = []; for await (const c of it) out.push(c); return out; }

test('Ollama stream: junta deltas e emite o chunk final done:true (mesmo sem conteudo e sem \\n final)', async () => {
  mode = 'ok';
  const p = new OllamaProvider({ baseUrl: base + '/' }); // barra final nao pode gerar //api
  const chunks = await collect(p.stream({ model: 'm1', messages: [{ role: 'user', content: 'x' }] }));
  assert.equal(chunks.map(c => c.delta).join(''), 'Ola');
  assert.equal(chunks.at(-1).done, true);
});

test('Ollama stream: linha {"error":...} vira erro (antes era engolida e a resposta saia vazia)', async () => {
  mode = 'error';
  const p = new OllamaProvider({ baseUrl: base });
  await assert.rejects(collect(p.stream({ model: 'm1', messages: [{ role: 'user', content: 'x' }] })), /model not found/);
});

test('Ollama: sem modelo selecionado da mensagem clara', async () => {
  const p = new OllamaProvider({ baseUrl: base });
  await assert.rejects(p.chat({ model: null, messages: [] }), /Nenhum modelo/);
});

test('Ollama: timeout vira mensagem clara (nao "aborted")', async () => {
  mode = 'hang';
  const p = new OllamaProvider({ baseUrl: base, timeoutMs: 150 });
  await assert.rejects(p.chat({ model: 'm1', messages: [{ role: 'user', content: 'x' }] }), err => /Tempo limite/.test(err.message) && err.code === 'TIMEOUT');
});

test('Ollama: cancelamento do usuario continua sendo AbortError', async () => {
  mode = 'hang';
  const p = new OllamaProvider({ baseUrl: base, timeoutMs: 5000 });
  const ac = new AbortController(); setTimeout(() => ac.abort(), 50);
  await assert.rejects(p.chat({ model: 'm1', messages: [], signal: ac.signal }), err => err.name === 'AbortError');
});

test('OpenAI-compatible: streaming SSE real (varios deltas, [DONE])', async () => {
  const p = new OpenAICompatibleProvider({ baseUrl: base + '/v1', apiKey: 'k', model: 'gpt-x' });
  const chunks = await collect(p.stream({ model: 'gpt-x', messages: [{ role: 'user', content: 'x' }] }));
  assert.equal(chunks.filter(c => c.delta).length, 2);
  assert.equal(chunks.map(c => c.delta).join(''), 'Ola mundo');
  assert.equal(chunks.at(-1).done, true);
});

test('OpenAI-compatible: envia a chave como Bearer sem expô-la em outros campos', () => {
  const withKey = new OpenAICompatibleProvider({ apiKey: 'test-secret' });
  const withoutKey = new OpenAICompatibleProvider();
  assert.equal(withKey._headers().Authorization, 'Bearer test-secret');
  assert.equal(Object.hasOwn(withoutKey._headers(), 'Authorization'), false);
});

test('OpenAI-compatible: lista GPT-6.1 Sol quando o endpoint o oferece e usa os parâmetros atuais', async () => {
  const p = new OpenAICompatibleProvider({ baseUrl: base + '/v1', apiKey: 'k' });
  assert.deepEqual((await p.listModels()).map(model => model.id), ['gpt-6.1-sol']);
  const body = JSON.parse(p._body('gpt-6.1-sol', [{ role: 'user', content: 'oi' }], {}, true));
  assert.equal(body.max_completion_tokens, 512);
  assert.equal(body.reasoning_effort, 'medium');
  assert.equal(Object.hasOwn(body, 'temperature'), false);
});
