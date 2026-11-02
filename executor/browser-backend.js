/* JARVES AI - backend embutido no navegador (modo "Executor HTML").
 * Substitui window.fetch para /api/* e /preview/*, guardando os dados em IndexedDB
 * e falando direto com Ollama ou com uma API compativel com OpenAI.
 * Mantem os mesmos formatos de resposta do backend Node (CORE/backend). */
(() => {
  'use strict';
  const VERSION = '2.3.2';
  const DEFAULTS = { ai_provider: 'auto', ollama_base_url: 'http://127.0.0.1:11434', ollama_model: 'qwen3.5:4b' };
  const ALLOWED = new Set(['ai_provider', 'ollama_base_url', 'ollama_model', 'openai_base_url', 'openai_api_key', 'openai_model',
    'ai_timeout_ms', 'theme', 'language', 'memory_enabled', 'max_upload_bytes', 'research_enabled', 'ai_quality']);
  const MAX_UPLOAD = 512 * 1024 * 1024;
  const MEMORY_MAX = 5000;
  const realFetch = window.fetch.bind(window);

  // ---------- util ----------
  const nowIso = () => new Date().toISOString();
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
  const enc = new TextEncoder();
  const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
  const err = (status, message, extra = {}) => json(status, { error: message, ...extra });
  const trimUrl = (u) => String(u || '').replace(/\/+$/, '');
  const isAbort = (e) => e && (e.name === 'AbortError' || /abort/i.test(e.message || ''));

  // ---------- armazenamento (IndexedDB, com fallback em memoria) ----------
  const emptyDb = () => ({ conversations: [], messages: [], memories: [], files: [], fileData: {}, tasks: [], steps: [], settings: {}, diag: null });
  let db = emptyDb();
  let persistent = false;
  let idb = null;
  let saveTimer = null;
  const openIdb = () => new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error('IndexedDB indisponivel'));
    const r = indexedDB.open('jarves-executor', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error('Falha ao abrir IndexedDB'));
  });
  const idbOp = (mode, fn) => new Promise((resolve, reject) => {
    const tx = idb.transaction('kv', mode);
    const req = fn(tx.objectStore('kv'));
    tx.oncomplete = () => resolve(req && req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transacao abortada'));
  });
  const ready = (async () => {
    try {
      idb = await openIdb();
      const saved = await idbOp('readonly', s => s.get('db'));
      if (saved && typeof saved === 'object') db = { ...emptyDb(), ...saved };
      persistent = true;
      if (db.settings.ai_provider === 'mock') { db.settings.ai_provider = 'auto'; save(); } // migra o antigo "modo demonstracao"
    } catch (e) { persistent = false; console.warn('[JARVES] Dados nao serao salvos entre sessoes:', e.message); }
  })();
  function save() {
    if (!persistent) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { idbOp('readwrite', s => s.put(db, 'db')).catch(e => console.warn('[JARVES] falha ao salvar:', e.message)); }, 250);
  }
  async function flush() { clearTimeout(saveTimer); if (persistent) await idbOp('readwrite', st => st.put(db, 'db')); }
  window.addEventListener('pagehide', () => { if (persistent && idb) { try { idb.transaction('kv', 'readwrite').objectStore('kv').put(db, 'db'); } catch {} } });

  // ---------- configuracoes ----------
  const getSetting = (k, d = null) => (db.settings[k] !== undefined && db.settings[k] !== '' ? db.settings[k] : d);
  function qualityOptions() {
    const q = getSetting('ai_quality', 'medium');
    if (q === 'low') return { temperature: 0.5, maxTokens: 2048 };
    if (q === 'high') return { temperature: 0.7, maxTokens: 16384 };
    return { temperature: 0.7, maxTokens: 8192 };
  }
  function resolveRuntime(providerOverride, modelOverride) {
    const name = providerOverride || getSetting('ai_provider', DEFAULTS.ai_provider);
    const timeoutMs = Number(getSetting('ai_timeout_ms', 0)) || 120000;
    const rt = { name, timeoutMs, baseUrl: '', apiKey: '', preferredModel: null };
    if (name === 'ollama' || name === 'auto') { rt.baseUrl = trimUrl(getSetting('ollama_base_url', DEFAULTS.ollama_base_url)); rt.preferredModel = getSetting('ollama_model', DEFAULTS.ollama_model); }
    else if (name === 'openai-compatible') { rt.baseUrl = trimUrl(getSetting('openai_base_url', '')); rt.apiKey = getSetting('openai_api_key', ''); rt.preferredModel = getSetting('openai_model', null); }
    rt.model = modelOverride || rt.preferredModel || null;
    return rt;
  }
  // Distingue "Ollama desligado" de "ligado, mas o navegador foi bloqueado (CORS)":
  // uma requisicao no-cors so resolve se algo estiver escutando na porta.
  let lastProblem = null;
  async function ollamaProblem(base) {
    let running = false;
    try { await realFetch(`${base}/api/tags`, { mode: 'no-cors', signal: AbortSignal.timeout(4000) }); running = true; } catch { running = false; }
    const p = running ? {
      kind: 'cors',
      short: `O Ollama esta ligado em ${base}, mas o navegador foi bloqueado (CORS). Libere com OLLAMA_ORIGINS=* e reinicie o Ollama (veja o aviso no topo).`,
      long: 'O Ollama esta ligado, mas bloqueou o acesso por este arquivo (CORS). Reinicie o Ollama liberando a origem:\n' +
        '• Linux: sudo systemctl edit ollama  → adicione  [Service]  Environment="OLLAMA_ORIGINS=*"  → sudo systemctl restart ollama\n' +
        '• Sem systemd: pare o Ollama e rode   OLLAMA_ORIGINS=* ollama serve\n' +
        '• Windows: setx OLLAMA_ORIGINS *  e reinicie o Ollama   • Mac: launchctl setenv OLLAMA_ORIGINS "*"  e reinicie',
    } : {
      kind: 'down',
      short: `O Ollama nao esta ligado em ${base}. Rode "ollama serve" (instale em ollama.com) e baixe um modelo; ou use o modo demonstracao.`,
      long: `Nao ha nada respondendo em ${base}.\n• Instale o Ollama (ollama.com), abra um terminal e rode:  ollama serve\n• Baixe um modelo:  ollama pull qwen3:4b  (depois escolha-o em Configuracoes > Modelos IA)\n• Ou use o botao abaixo para testar a interface sem IA.`,
    };
    lastProblem = p; showBanner(p); return p;
  }
  function showBanner(p) {
    let b = document.getElementById('jarvesBanner');
    if (!p) { if (b) b.remove(); return; }
    if (!document.body) return;
    if (!b) {
      b = document.createElement('div'); b.id = 'jarvesBanner';
      b.style.cssText = 'position:fixed;bottom:120px;left:50%;transform:translateX(-50%);z-index:9999;max-width:min(760px,94vw);background:#1a1f36;color:#e7ebff;border:1px solid #f0b429;border-radius:12px;padding:14px 16px;box-shadow:0 8px 30px rgba(0,0,0,.5);font:14px/1.5 system-ui,sans-serif';
      document.body.appendChild(b);
    }
    b.replaceChildren();
    const h = document.createElement('b'); h.textContent = p.kind === 'cors' ? 'Ollama bloqueado pelo navegador' : 'Ollama nao encontrado'; h.style.color = '#f0b429';
    const d = document.createElement('div'); d.textContent = p.long; d.style.cssText = 'white-space:pre-wrap;margin:6px 0 10px;font-size:13px';
    const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
    const btn = (t, fn) => { const x = document.createElement('button'); x.type = 'button'; x.className = 'secondary-btn'; x.textContent = t; x.style.cssText = 'padding:6px 10px'; x.addEventListener('click', fn); return x; };
    row.append(
      btn('Usar IA base (offline)', async () => { db.settings.ai_provider = 'base'; try { await flush(); } catch {} location.reload(); }),
      btn('Tentar de novo', () => location.reload()),
      btn('Fechar', () => b.remove()));
    b.append(h, d, row);
  }
  const fileHint = () => '';

  // timeout de inatividade combinado com o cancelamento do usuario
  function withTimeout(signal, ms) {
    const c = new AbortController();
    let timedOut = false; let timer;
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => { timedOut = true; c.abort(); }, ms); };
    arm();
    if (signal) { if (signal.aborted) c.abort(); else signal.addEventListener('abort', () => c.abort(), { once: true }); }
    return { signal: c.signal, touch: arm, timedOut: () => timedOut, cleanup: () => clearTimeout(timer) };
  }
  const timeoutError = (what, ms) => new Error(`Tempo limite: ${what} nao respondeu em ${Math.round(ms / 1000)}s.`);

  // ---------- provedores ----------
  async function listModels(rt) {
    if (rt.name === 'mock') return [{ id: 'mock-model-1', name: 'mock-model-1', provider: 'mock' }];
    if (rt.name === 'base') return [BASE_ENTRY];
    if (rt.name === 'auto') {
      let found = [];
      try {
        const res = await realFetch(`${rt.baseUrl}/api/tags`, { signal: AbortSignal.timeout(2500) });
        if (res.ok) found = ((await res.json()).models || []).map(m => ({ id: m.name, name: m.name, provider: 'ollama', size: m.size, modified: m.modified_at, capabilities: m.details?.families || [] }));
      } catch { /* Ollama desligado ou bloqueado (CORS): fica so a IA base */ }
      return [...found, BASE_ENTRY];
    }
    if (rt.name === 'ollama') {
      let res;
      try { res = await realFetch(`${rt.baseUrl}/api/tags`, { signal: AbortSignal.timeout(10000) }); }
      catch (e) { throw new Error((await ollamaProblem(rt.baseUrl)).short); }
      if (!res.ok) throw new Error(`Ollama indisponivel: HTTP ${res.status}`);
      const data = await res.json();
      showBanner(null);
      return (data.models || []).map(m => ({ id: m.name, name: m.name, provider: 'ollama', size: m.size, modified: m.modified_at, capabilities: m.details?.families || [] }));
    }
    if (rt.name === 'openai-compatible') {
      if (!rt.baseUrl) return [];
      let res;
      try { res = await realFetch(`${rt.baseUrl}/models`, { headers: oaiHeaders(rt), signal: AbortSignal.timeout(10000) }); }
      catch (e) { throw new Error(`Provedor externo inacessivel em ${rt.baseUrl}: ${e.message}`); }
      if (!res.ok) throw new Error(`Provedor externo indisponivel: HTTP ${res.status}`);
      const data = await res.json();
      return (data.data || data.models || []).map(m => ({ id: m.id || m.name, name: m.id || m.name, provider: 'openai-compatible' }));
    }
    throw new Error('Provedor desconhecido: ' + rt.name);
  }
  const BASE_ENTRY = { id: 'jarves-base', name: 'jarves-base', provider: 'base' };
  const oaiHeaders = (rt) => ({ 'Content-Type': 'application/json', ...(rt.apiKey ? { Authorization: `Bearer ${rt.apiKey}` } : {}) });
  const cleanMsgs = (messages) => messages.map(m => ({ role: m.role, content: m.content }));

  async function* readLines(res, t) {
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      t.touch(); buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n'); buf = lines.pop() || '';
      for (const l of lines) yield l;
    }
    if (buf.trim()) yield buf;
  }

  // Gera { delta, model, provider, done }. stream=false devolve tudo em um unico pedaco.
  async function* generate(rt, messages, options, signal, stream = true) {
    let model = rt.model;
    const baseStream = async function* () {
      const text = window.JARVES_BASE.reply(messages);
      for (let i = 0; i < text.length; i += 48) {
        if (signal?.aborted) throw new Error('abortado');
        await new Promise(r => setTimeout(r, 8));
        yield { delta: text.slice(i, i + 48), model: 'jarves-base', provider: 'base', done: false };
      }
      yield { delta: '', model: 'jarves-base', provider: 'base', done: true };
    };
    if (rt.name === 'base') { yield* baseStream(); return; }
    if (rt.name === 'auto') {
      // Ollama se estiver ligado (e o modelo existir); senao IA base. Se o Ollama falhar antes de responder, cai para a base.
      let list = [];
      if (model !== 'jarves-base') { try { list = (await listModels(rt)).filter(m => m.provider === 'ollama'); } catch { list = []; } }
      if (!list.length) { yield* baseStream(); return; }
      if (!list.some(m => m.id === model)) model = list[0].id;
      let started = false;
      try {
        for await (const ch of generate({ ...rt, name: 'ollama', model }, messages, options, signal, stream)) { if (ch.delta) started = true; yield ch; }
      } catch (e) {
        if (started || isAbort(e) || signal?.aborted) throw e;
        yield { delta: '⚠️ O Ollama não respondeu; usando a IA base.\n\n', model: 'jarves-base', provider: 'base', done: false };
        yield* baseStream();
      }
      return;
    }
    if (rt.name === 'mock') {
      if (signal?.aborted) throw new Error('abortado');
      const last = messages[messages.length - 1]?.content || '';
      const text = `Resposta simulada do JARVES AI. [eco: ${last.slice(0, 80)}]`;
      for (const p of (text.match(/.{1,20}/g) || [text])) {
        await new Promise(r => setTimeout(r, 10));
        if (signal?.aborted) throw new Error('abortado');
        yield { delta: p, model: model || 'mock-model-1', provider: 'mock', done: false };
      }
      yield { delta: '', model: model || 'mock-model-1', provider: 'mock', done: true };
      return;
    }
    const t = withTimeout(signal, rt.timeoutMs);
    try {
      if (rt.name === 'ollama') {
        if (!model) throw new Error('Nenhum modelo Ollama selecionado. Escolha ou instale um modelo em Configuracoes > Modelos IA.');
        let res;
        try {
          res = await realFetch(`${rt.baseUrl}/api/chat`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: t.signal,
            body: JSON.stringify({ model, messages: cleanMsgs(messages), stream, think: false, keep_alive: '30m', options: { temperature: options.temperature ?? 0.6, num_predict: options.maxTokens ?? 8192, num_ctx: options.numCtx ?? 16384, top_p: options.topP ?? 0.85 } }),
          });
        } catch (e) { if (t.timedOut()) throw timeoutError('o Ollama', rt.timeoutMs); if (isAbort(e)) throw e; throw new Error((await ollamaProblem(rt.baseUrl)).short); }
        if (!res.ok) throw new Error(`Ollama erro ${res.status}: ${(await res.text()).slice(0, 300)}`);
        if (!stream) {
          const d = await res.json();
          if (d.error) throw new Error('Ollama: ' + d.error);
          yield { delta: d.message?.content || '', model: d.model || model, provider: 'ollama', done: true, usage: { prompt: d.prompt_eval_count, completion: d.eval_count } };
          return;
        }
        let finished = false;
        for await (const line of readLines(res, t)) {
          const s = line.trim(); if (!s) continue;
          let o; try { o = JSON.parse(s); } catch { continue; }
          if (o.error) throw new Error('Ollama: ' + o.error);
          if (o.message?.content) yield { delta: o.message.content, model: o.model || model, provider: 'ollama', done: false };
          if (o.done) { finished = true; yield { delta: '', model: o.model || model, provider: 'ollama', done: true }; break; }
        }
        if (!finished) yield { delta: '', model, provider: 'ollama', done: true };
        return;
      }
      if (rt.name === 'openai-compatible') {
        if (!rt.baseUrl) throw new Error('Endpoint do provedor externo nao configurado (Configuracoes > Conexao)');
        if (!model) throw new Error('Modelo externo nao configurado');
        let res;
        try {
          res = await realFetch(`${rt.baseUrl}/chat/completions`, {
            method: 'POST', headers: oaiHeaders(rt), signal: t.signal,
            body: JSON.stringify({ model, stream, messages: cleanMsgs(messages), temperature: options.temperature ?? 0.6, max_tokens: options.maxTokens ?? 512, top_p: options.topP ?? 0.85 }),
          });
        } catch (e) { if (t.timedOut()) throw timeoutError('o provedor externo', rt.timeoutMs); if (isAbort(e)) throw e; throw new Error(`Provedor externo inacessivel em ${rt.baseUrl}: ${e.message}`); }
        if (!res.ok) throw new Error(`Provedor externo erro ${res.status}: ${(await res.text()).slice(0, 300)}`);
        if (!stream || !(res.headers.get('content-type') || '').includes('text/event-stream')) {
          const d = await res.json();
          yield { delta: d.choices?.[0]?.message?.content || '', model: d.model || model, provider: 'openai-compatible', done: true, usage: d.usage };
          return;
        }
        let used = model;
        for await (const raw of readLines(res, t)) {
          const line = raw.trim(); if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') { yield { delta: '', model: used, provider: 'openai-compatible', done: true }; return; }
          let o; try { o = JSON.parse(payload); } catch { continue; }
          if (o.error) throw new Error('Provedor externo: ' + (o.error.message || JSON.stringify(o.error)));
          used = o.model || used;
          const delta = o.choices?.[0]?.delta?.content;
          if (delta) yield { delta, model: used, provider: 'openai-compatible', done: false };
        }
        yield { delta: '', model: used, provider: 'openai-compatible', done: true };
        return;
      }
      throw new Error('Provedor desconhecido: ' + rt.name);
    } catch (e) {
      if (t.timedOut()) throw timeoutError('a resposta do provedor', rt.timeoutMs);
      throw e;
    } finally { t.cleanup(); }
  }

  async function chatOnce({ provider, model, messages, options = {}, signal }) {
    const rt = resolveRuntime(provider, model);
    let content = ''; let usage; let outModel = rt.model;
    for await (const c of generate(rt, messages, { ...qualityOptions(), ...options }, signal, false)) {
      content += c.delta || ''; usage = c.usage || usage; outModel = c.model || outModel;
    }
    return { content, model: outModel, provider: rt.name, usage };
  }

  // ---------- conversas ----------
  const getConv = (id) => db.conversations.find(c => c.id === id) || null;
  function createConversation({ title = 'Nova conversa', model = null, provider = null, agentId = null } = {}) {
    const now = nowIso();
    const c = { id: newId(), title, created_at: now, updated_at: now, model, provider, agent_id: agentId, archived: 0 };
    db.conversations.push(c); save(); return c;
  }
  const listMessages = (cid) => db.messages.filter(m => m.conversation_id === cid);
  function addMessage({ conversationId, role, content, model = null, provider = null, error = null }) {
    const m = { id: newId(), conversation_id: conversationId, role, content, created_at: nowIso(), model, provider, error };
    db.messages.push(m);
    const c = getConv(conversationId); if (c) c.updated_at = m.created_at;
    save(); return m;
  }
  function updateConversation(id, patch) {
    const c = getConv(id); if (!c) return null;
    if (patch.title !== undefined) c.title = patch.title;
    if (patch.model !== undefined) c.model = patch.model;
    if (patch.provider !== undefined) c.provider = patch.provider;
    const ag = patch.agent_id !== undefined ? patch.agent_id : patch.agentId;
    if (ag !== undefined) c.agent_id = ag;
    if (patch.archived !== undefined) c.archived = patch.archived ? 1 : 0;
    c.updated_at = nowIso(); save(); return c;
  }
  const byUpdatedDesc = (a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0);

  const active = new Map(); // requestId -> AbortController

  async function handleChat(body, reqSignal) {
    const { conversationId, message, provider, model, systemPrompt, stream } = body || {};
    if (!message || typeof message !== 'string') return err(400, 'message obrigatorio');
    const requestId = (typeof body.requestId === 'string' && body.requestId.trim()) ? body.requestId.trim().slice(0, 160)
      : `${conversationId || 'new'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    if (active.has(requestId)) return err(409, 'Ja existe uma requisicao ativa com este identificador', { requestId });
    let conv = conversationId ? getConv(conversationId) : null;
    if (conversationId && !conv) return err(404, 'Conversa nao encontrada');
    if (!conv) conv = createConversation({ title: message.trim().slice(0, 60) || 'Nova conversa', model, provider });
    const convId = conv.id;
    if (model || provider) updateConversation(convId, { model: model ?? conv.model, provider: provider ?? conv.provider });
    const hist = listMessages(convId).filter(m => !m.error).map(m => ({ role: m.role, content: m.content }));
    addMessage({ conversationId: convId, role: 'user', content: message, model, provider });
    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    for (const h of hist) if (h.role && h.content) messages.push(h);
    messages.push({ role: 'user', content: message });

    const ctrl = new AbortController();
    active.set(requestId, ctrl);
    if (reqSignal) { if (reqSignal.aborted) ctrl.abort(); else reqSignal.addEventListener('abort', () => ctrl.abort(), { once: true }); }
    const rt = resolveRuntime(provider, model);
    const opts = qualityOptions();

    if (!stream) {
      try {
        const r = await chatOnce({ provider, model, messages, signal: ctrl.signal });
        const saved = addMessage({ conversationId: convId, role: 'assistant', content: r.content, model: r.model, provider: r.provider });
        return json(200, { requestId, conversationId: convId, message: saved, content: r.content, model: r.model, provider: r.provider, usage: r.usage });
      } catch (e) {
        const aborted = isAbort(e);
        addMessage({ conversationId: convId, role: 'assistant', content: '', model, provider, error: e.message });
        return err(aborted ? 499 : 502, e.message, { requestId, conversationId: convId, aborted });
      } finally { active.delete(requestId); }
    }

    const body$ = new ReadableStream({
      async start(c) {
        const send = (o) => { try { c.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`)); } catch {} };
        let full = ''; let fm = model; let fp = provider;
        try {
          for await (const ch of generate(rt, messages, opts, ctrl.signal, true)) {
            if (ch.delta) { full += ch.delta; send({ type: 'delta', delta: ch.delta }); }
            fm = ch.model || fm; fp = ch.provider || fp;
            if (ch.done) send({ type: 'done', model: fm, provider: fp });
          }
          const saved = addMessage({ conversationId: convId, role: 'assistant', content: full, model: fm, provider: fp });
          send({ type: 'saved', messageId: saved.id, conversationId: convId });
        } catch (e) {
          const aborted = isAbort(e) || ctrl.signal.aborted;
          send({ type: 'error', error: e.message, aborted, conversationId: convId });
          addMessage({ conversationId: convId, role: 'assistant', content: full, model: fm, provider: fp, error: aborted ? 'Interrompido' : e.message });
        } finally { active.delete(requestId); try { c.close(); } catch {} }
      },
      cancel() { ctrl.abort(); },
    });
    return new Response(body$, { status: 200, headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform' } });
  }

  // ---------- agentes e tarefas ----------
  const AGENTS = [
    ['general', 'Assistente Geral', 'Conversacao, explicacoes e tarefas comuns.', ['chat'], 'Voce e o JARVES AI, um assistente geral em portugues brasileiro. Seja claro, preciso e util. Admita limitacoes.'],
    ['programmer', 'Programador', 'Analise, escrita e revisao de codigo.', ['code_analyze', 'run_tests'], 'Voce e um agente programador especialista. Analise, escreva, explique e revise codigo. Use blocos de codigo. Identifique bugs e sugira testes.'],
    ['researcher', 'Pesquisador', 'Pesquisa de informacoes e fontes.', ['research'], 'Voce e um agente pesquisador. Sintetize informacoes, cite fontes quando disponiveis, distinga fatos de hipoteses.'],
    ['studies', 'Estudos', 'Explicacoes, exercicios e planos de estudo.', [], 'Voce e um agente de estudos. Explique de forma didatica, crie exercicios e planos de estudo.'],
    ['planner', 'Planejador', 'Divisao de objetivos em etapas.', [], 'Voce e um agente planejador. Divida objetivos em etapas, dependencias e prioridades. Produza planos estruturados.'],
    ['filemanager', 'Gerenciador de Arquivos', 'Listagem, leitura e analise de arquivos.', ['file_list', 'file_read'], 'Voce e um agente gerenciador de arquivos. Analise arquivos fornecidos, organize e explique conteudo. Nao execute arquivos.'],
    ['gamedev', 'Desenvolvedor de Jogos', 'Planejamento e codigo de jogos.', [], 'Voce e um agente desenvolvedor de jogos. Planeje estruturas de projeto, mecanicas e codigo de jogos.'],
    ['reviewer', 'Revisor de Qualidade', 'Analise de erros e testes.', ['code_analyze', 'run_tests'], 'Voce e um revisor de qualidade. Analise erros, sugira testes, identifique regressoes e melhorias.'],
    ['productivity', 'Produtividade', 'Tarefas, listas e documentos.', [], 'Voce e um agente de produtividade. Organize tarefas, listas e documentos.'],
    ['coordinator', 'Coordenador', 'Escolha e consolidacao de agentes.', [], 'Voce e o coordenador. Escolha agentes apropriados, distribua subtarefas e consolide resultados. Seja conciso.'],
  ].map(([id, name, description, allowedTools, systemPrompt]) => ({ id, name, description, allowedTools, systemPrompt, available: true }));
  const agentMap = Object.fromEntries(AGENTS.map(a => [a.id, a]));
  function selectAgents(goal) {
    const g = (goal || '').toLowerCase(); const s = new Set(['general']);
    if (/c[oó]digo|program|bug|fun[cç][aã]o|api|javascript|python|node/.test(g)) s.add('programmer');
    if (/pesquis|buscar|fonte|informa[cç][aã]o|not[ií]cia/.test(g)) s.add('researcher');
    if (/estud|aprender|exerc[ií]cio|aula|prova/.test(g)) s.add('studies');
    if (/plan|etapa|projeto|cronograma|roadmap/.test(g)) s.add('planner');
    if (/arquivo|pasta|diret[oó]rio|upload/.test(g)) s.add('filemanager');
    if (/jogo|game|unity|godot/.test(g)) s.add('gamedev');
    if (/revis|qualidade|teste|erro/.test(g)) s.add('reviewer');
    if (/tarefa|lista|organiz|documento|relat[oó]rio/.test(g)) s.add('productivity');
    if (s.size > 2) s.add('coordinator');
    return [...s];
  }
  async function createPlan(goal, ctx = {}) {
    let steps = [];
    try {
      const res = await chatOnce({ provider: ctx.provider, model: ctx.model, options: { temperature: 0.3, maxTokens: 1024 },
        messages: [{ role: 'user', content: `Divida o objetivo em etapas executaveis. Responda APENAS em JSON valido no formato:\n{"steps":[{"title":"...","agent":"id do agente","dependsOn":[]}]}. Objetivo: ${goal}` }] });
      const m = res.content.match(/\{[\s\S]*\}/);
      if (m) { const p = JSON.parse(m[0]); if (Array.isArray(p.steps)) steps = p.steps; }
    } catch { /* usa o plano padrao */ }
    if (!steps.length) steps = selectAgents(goal).map((id, i) => ({ title: `Etapa ${i + 1}: ${agentMap[id]?.name || id}`, agent: id, dependsOn: i > 0 ? [i - 1] : [] }));
    return steps.slice(0, 8).map((s, i) => ({
      title: String(s.title || `Etapa ${i + 1}`),
      agent: agentMap[s.agent] ? s.agent : (selectAgents(goal)[0] || 'general'),
      dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn : [],
    }));
  }
  const taskView = (t) => t && ({ ...t, steps: db.steps.filter(s => s.task_id === t.id).sort((a, b) => a.idx - b.idx) });
  function createTask({ goal, conversationId = null, plan = [] }) {
    const now = nowIso();
    const t = { id: newId(), conversation_id: conversationId, goal, status: 'pending', plan, result: null, error: null, created_at: now, updated_at: now };
    db.tasks.push(t);
    plan.forEach((s, i) => db.steps.push({ id: newId(), task_id: t.id, idx: i, title: s.title, status: 'pending', agent_id: s.agent, input: null, output: null, error: null, started_at: null, finished_at: null }));
    save(); return taskView(t);
  }
  const running = new Map();
  const clip = (s, n) => { const t = String(s || ''); return t.length > n ? t.slice(0, n) + ' [...]' : t; };
  async function runTask(taskId, ctx = {}) {
    const task = db.tasks.find(t => t.id === taskId);
    if (!task) { const e = new Error('Tarefa nao encontrada'); e.status = 404; throw e; }
    if (running.has(taskId)) { const e = new Error('Tarefa ja esta em execucao'); e.status = 409; throw e; }
    const ctrl = new AbortController(); running.set(taskId, ctrl);
    task.status = 'running'; task.updated_at = nowIso(); save();
    const steps = db.steps.filter(s => s.task_id === taskId).sort((a, b) => a.idx - b.idx);
    const results = []; const cancelled = () => ctrl.signal.aborted || task.status === 'cancelled';
    try {
      let executed = 0;
      for (const step of steps) {
        if (cancelled() || executed >= 10) break;
        step.status = 'running'; step.started_at = nowIso();
        const agent = agentMap[step.agent_id] || agentMap.general;
        const previous = results.filter(r => !r.error).map(r => `### ${r.step}\n${clip(r.output, 1500)}`).join('\n\n');
        const prompt = `Objetivo geral: ${task.goal}\n\nEtapa ${executed + 1} de ${steps.length}: ${step.title}` +
          (previous ? `\n\nResultados das etapas anteriores:\n${previous}` : '') + '\n\nExecute apenas esta etapa e responda de forma objetiva.';
        try {
          const r = await chatOnce({ provider: ctx.provider, model: ctx.model, signal: ctrl.signal, messages: [{ role: 'system', content: agent.systemPrompt }, { role: 'user', content: prompt }] });
          step.status = 'done'; step.output = (r.content || '').slice(0, 4000); step.error = null;
          results.push({ step: step.title, output: r.content });
        } catch (e) {
          const c = cancelled();
          step.status = c ? 'cancelled' : 'failed'; step.output = null; step.error = c ? 'Cancelado' : e.message;
          if (!c) results.push({ step: step.title, error: e.message });
        }
        step.finished_at = nowIso(); executed++; save();
      }
      const c = cancelled();
      task.result = results.map(r => `## ${r.step}\n${r.error ? 'ERRO: ' + r.error : (r.output || '')}`).join('\n\n');
      task.status = c ? 'cancelled' : (results.every(r => !r.error) ? 'done' : 'partial');
      if (c) steps.forEach(s => { if (s.status === 'pending' || s.status === 'running') s.status = 'cancelled'; });
      task.updated_at = nowIso(); save();
    } finally { running.delete(taskId); }
    return taskView(task);
  }
  function cancelTask(id) {
    const t = db.tasks.find(x => x.id === id); if (!t) return null;
    t.status = 'cancelled'; t.updated_at = nowIso();
    db.steps.forEach(s => { if (s.task_id === id && ['pending', 'running', 'awaiting'].includes(s.status)) s.status = 'cancelled'; });
    running.get(id)?.abort(); save(); return taskView(t);
  }

  // ---------- arquivos ----------
  const classify = (mime, name) => {
    const n = (name || '').toLowerCase();
    if (mime?.startsWith('image/')) return 'image';
    if (/\.(js|mjs|ts)$/.test(n)) return 'code-js';
    if (n.endsWith('.py')) return 'code-py';
    if (n.endsWith('.json')) return 'json';
    if (/\.(md|txt)$/.test(n)) return 'text';
    if (/\.(html|css)$/.test(n)) return 'web';
    return 'other';
  };
  const b64ToBytes = (b64) => { const bin = atob(b64.replace(/\s/g, '')); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
  function analyzeCode(code) {
    const issues = [];
    if (!code) return { issues, summary: 'Codigo vazio' };
    const lines = code.split(/\n/);
    if (/\beval\s*\(/.test(code)) issues.push({ severity: 'high', message: 'Uso de eval detectado' });
    if (/password\s*=\s*['"][^'"]+['"]/.test(code)) issues.push({ severity: 'high', message: 'Possivel segredo hardcoded' });
    if (/TODO|FIXME/.test(code)) issues.push({ severity: 'low', message: 'TODO/FIXME encontrado' });
    if (lines.length > 1000) issues.push({ severity: 'medium', message: 'Arquivo muito longo, considere modularizar' });
    const open = (code.match(/[{[(]/g) || []).length; const close = (code.match(/[}\])]/g) || []).length;
    if (Math.abs(open - close) > 5) issues.push({ severity: 'medium', message: 'Possivel desbalanceamento de parenteses/chaves' });
    return { issues, lineCount: lines.length, summary: issues.length ? `${issues.length} problema(s) potencial(is)` : 'Nenhum problema obvio detectado' };
  }

  // ---------- diagnostico ----------
  async function runDiagnostics() {
    const errors = []; const checks = [];
    const mk = (p) => ({ id: 'ERR-' + Math.random().toString(36).slice(2, 8).toUpperCase(), line: null, status: 'PENDENTE', testResult: 'NAO_TESTADO', description: '', probableCause: '', recommendedFix: '', ...p });
    checks.push({ name: 'database', ok: persistent, mode: persistent ? 'IndexedDB' : 'memoria' });
    if (!persistent) errors.push(mk({ name: 'Dados nao serao salvos', file: 'navegador', category: 'BANCO_DE_DADOS', severity: 'ALTO', description: 'IndexedDB indisponivel (janela privada ou bloqueio do navegador).', probableCause: 'Armazenamento bloqueado.', recommendedFix: 'Abra em uma janela normal e permita armazenamento do site.' }));
    try {
      const rt = resolveRuntime(null, null); const models = await listModels(rt);
      if (!models.length) throw new Error('Nenhum modelo disponivel');
      checks.push({ name: 'provider', ok: true, provider: rt.name, models: models.length });
    } catch (e) {
      checks.push({ name: 'provider', ok: false, error: e.message });
      errors.push(mk({ name: 'Provedor de IA indisponivel', file: 'configuracoes', category: 'IA', severity: 'ALTO', description: 'Nao foi possivel listar modelos do provedor configurado.', probableCause: e.message, recommendedFix: 'Inicie o Ollama (ollama serve), baixe um modelo ou configure o provedor em Configuracoes.' }));
    }
    try {
      const est = navigator.storage?.estimate ? await navigator.storage.estimate() : null;
      checks.push({ name: 'storage', ok: true, usageMB: est ? +(est.usage / 1048576).toFixed(2) : null, quotaMB: est ? Math.round(est.quota / 1048576) : null });
    } catch (e) { checks.push({ name: 'storage', ok: false, error: e.message }); }
    checks.push({ name: 'tests', ok: true, skipped: true, note: 'Suite de testes so existe na versao com servidor (npm test).' });
    const c = (s) => errors.filter(e => e.severity === s).length;
    const report = { id: 'DIAG-' + Date.now(), timestamp: nowIso(), mode: 'executor-html',
      summary: { totalErrors: errors.length, critical: c('CRITICO'), high: c('ALTO'), medium: c('MEDIO'), low: c('BAIXO'), info: c('INFORMATIVO'), testsPass: 0, testsFail: 0 },
      checks, errors, resolvedBugs: [], recommendations: errors.map(e => e.recommendedFix).filter(Boolean) };
    db.diag = report; save(); return report;
  }

  // ---------- roteador ----------
  const settingsMasked = () => { const all = { ...db.settings }; if (all.openai_api_key) all.openai_api_key = '***' + String(all.openai_api_key).slice(-4); return all; };
  const normMem = (m) => m;
  async function route(method, path, q, body, signal) {
    let m;
    if (path === '/api/health' && method === 'GET') return json(200, { status: 'ok', db: persistent, time: nowIso(), version: VERSION, mode: 'executor-html' });

    // conversas
    if (path === '/api/conversations') {
      if (method === 'GET') {
        const s = (q.get('search') || '').toLowerCase(); const limit = Number(q.get('limit')) || 100; const off = Number(q.get('offset')) || 0;
        let list = db.conversations.filter(c => !c.archived);
        if (s) list = list.filter(c => c.title.toLowerCase().includes(s) || db.messages.some(x => x.conversation_id === c.id && String(x.content).toLowerCase().includes(s)));
        return json(200, list.slice().sort(byUpdatedDesc).slice(off, off + limit));
      }
      if (method === 'POST') { const b = body || {}; return json(201, createConversation({ title: b.title || 'Nova conversa', model: b.model, provider: b.provider, agentId: b.agentId })); }
    }
    if ((m = path.match(/^\/api\/conversations\/([^/]+)(\/messages)?$/))) {
      const id = decodeURIComponent(m[1]); const c = getConv(id);
      if (!c) return err(404, 'Conversa nao encontrada');
      if (!m[2]) {
        if (method === 'GET') return json(200, { ...c, messages: listMessages(id) });
        if (method === 'PATCH') return json(200, updateConversation(id, body || {}));
        if (method === 'DELETE') { db.conversations = db.conversations.filter(x => x.id !== id); db.messages = db.messages.filter(x => x.conversation_id !== id); save(); return json(200, { ok: true }); }
      } else {
        if (method === 'GET') return json(200, listMessages(id));
        if (method === 'DELETE') { db.messages = db.messages.filter(x => x.conversation_id !== id); save(); return json(200, { ok: true }); }
        if (method === 'POST') {
          const { role, content, model, provider, error } = body || {};
          if (!role || content === undefined) return err(400, 'role e content obrigatorios');
          if (!['user', 'assistant', 'system'].includes(role)) return err(400, 'role invalido');
          return json(201, addMessage({ conversationId: id, role, content, model, provider, error }));
        }
      }
    }

    // chat
    if (path === '/api/chat' && method === 'POST') return handleChat(body, signal);
    if (path === '/api/chat/cancel' && method === 'POST') {
      const rid = body?.requestId; if (!rid) return err(400, 'requestId obrigatorio');
      const c = active.get(rid); if (!c) return err(404, 'Requisicao nao encontrada ou ja finalizada');
      c.abort(); return json(200, { ok: true });
    }
    if (path === '/api/chat/active' && method === 'GET') return json(200, { count: active.size, ids: [...active.keys()] });

    // modelos
    if (path === '/api/models' && method === 'GET') {
      const rt = resolveRuntime(q.get('provider') || null, null);
      try { return json(200, { provider: rt.name, models: await listModels(rt), selected: rt.preferredModel || null, error: null }); }
      catch (e) { return json(200, { provider: rt.name, models: [], selected: rt.preferredModel || null, error: e.message }); }
    }
    if (path === '/api/models/check' && method === 'GET') {
      const provider = q.get('provider'); const model = q.get('model');
      if (!provider || !model) return err(400, 'provider e model obrigatorios');
      try { const ms = await listModels(resolveRuntime(provider, null)); return json(200, { provider, model, available: ms.some(x => x.id === model) }); }
      catch (e) { return json(200, { provider, model, available: false, error: e.message }); }
    }
    if (path === '/api/models/pull' && method === 'POST') {
      const model = body?.model;
      if (typeof model !== 'string' || !/^[a-zA-Z0-9._:/-]{1,160}$/.test(model)) return err(400, 'Nome de modelo inválido.');
      const base = trimUrl(getSetting('ollama_base_url', DEFAULTS.ollama_base_url));
      try {
        const res = await realFetch(`${base}/api/pull`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, stream: false }), signal: AbortSignal.timeout(30 * 60 * 1000) });
        if (!res.ok) return err(res.status, `Ollama não conseguiu baixar o modelo: ${(await res.text()).slice(0, 240)}`);
        const r = await res.json().catch(() => ({}));
        return json(200, { ok: true, model, status: r.status || 'sucesso' });
      } catch (e) { return err(502, e.name === 'TimeoutError' ? 'Tempo limite ao baixar o modelo.' : (await ollamaProblem(base)).short); }
    }

    // configuracoes
    if (path === '/api/settings' && method === 'GET') return json(200, { settings: settingsMasked(), defaults: { ai_provider: DEFAULTS.ai_provider, ollama_base_url: DEFAULTS.ollama_base_url, ollama_model: DEFAULTS.ollama_model } });
    if ((m = path.match(/^\/api\/settings\/([^/]+)$/))) {
      const key = decodeURIComponent(m[1]);
      if (method === 'GET') {
        if (!ALLOWED.has(key)) return err(404, 'Configuracao nao encontrada');
        const v = getSetting(key, null); return json(200, { key, value: key === 'openai_api_key' && v ? '***' + String(v).slice(-4) : v });
      }
      if (method === 'DELETE') { if (!ALLOWED.has(key)) return err(400, 'Chave nao permitida'); delete db.settings[key]; save(); return json(200, { ok: true }); }
      if (method === 'PUT') {
        if (!ALLOWED.has(key)) return err(400, 'Chave nao permitida');
        const value = body?.value;
        if (value === undefined) return err(400, 'value obrigatorio');
        if (!['string', 'number', 'boolean'].includes(typeof value)) return err(400, 'value deve ser texto, numero ou booleano');
        if (value === '') { delete db.settings[key]; save(); return json(200, { ok: true, key, value: null, cleared: true }); }
        if (key === 'openai_api_key' && typeof value === 'string' && /^\*{3,}/.test(value)) return json(200, { ok: true, key, preserved: true });
        if (['ollama_base_url', 'openai_base_url'].includes(key)) { try { const u = new URL(String(value)); if (!['http:', 'https:'].includes(u.protocol)) throw 0; } catch { return err(400, 'URL invalida: use http:// ou https://'); } }
        if (key === 'openai_api_key' && (typeof value !== 'string' || value.length > 4096)) return err(400, 'API key invalida');
        if (key === 'ai_timeout_ms' && Number(value) > 600000) return err(400, 'timeout maximo: 600000 ms');
        if (key === 'ai_timeout_ms' && (isNaN(Number(value)) || Number(value) < 1000)) return err(400, 'timeout invalido');
        if (key === 'ai_provider' && !['auto', 'ollama', 'openai-compatible', 'base', 'mock'].includes(value)) return err(400, 'provedor invalido');
        if (key === 'ai_quality' && !['low', 'medium', 'high'].includes(value)) return err(400, 'qualidade invalida');
        db.settings[key] = value; save();
        return json(200, { ok: true, key, value: key === 'openai_api_key' ? '***' + String(value).slice(-4) : value });
      }
    }

    // memoria
    if (path === '/api/memory') {
      if (method === 'GET') {
        let l = db.memories.slice(); const kind = q.get('kind'); const en = q.get('enabled'); const sq = (q.get('q') || '').toLowerCase();
        if (kind) l = l.filter(x => x.kind === kind);
        if (en !== null) l = l.filter(x => x.enabled === (en === 'true'));
        if (sq) l = l.filter(x => [x.content, x.subject, x.tags].some(v => String(v || '').toLowerCase().includes(sq)));
        const limit = Number(q.get('limit')) || 200; const off = Number(q.get('offset')) || 0;
        return json(200, l.sort(byUpdatedDesc).slice(off, off + limit));
      }
      if (method === 'POST') {
        const { kind, subject, content, tags, enabled } = body || {};
        if (!content || typeof content !== 'string' || !content.trim()) return err(400, 'content obrigatorio');
        if (db.memories.length >= MEMORY_MAX) return err(400, 'Limite de memoria atingido');
        const now = nowIso();
        const mem = { id: newId(), kind: kind || 'note', subject: subject ?? null, content, tags: Array.isArray(tags) ? tags.join(',') : (tags ?? null), enabled: enabled === undefined ? true : !!enabled, created_at: now, updated_at: now };
        db.memories.push(mem); save(); return json(201, normMem(mem));
      }
    }
    if (path === '/api/memory/search' && method === 'GET') {
      const sq = (q.get('q') || '').trim().toLowerCase(); if (!sq) return json(200, []);
      return json(200, db.memories.filter(x => [x.content, x.subject, x.tags].some(v => String(v || '').toLowerCase().includes(sq))).sort(byUpdatedDesc).slice(0, 50));
    }
    if (path === '/api/memory/status' && method === 'GET') return json(200, { enabled: true });
    if (path === '/api/memory/clear' && method === 'POST') { db.memories = []; save(); return json(200, { ok: true }); }
    if ((m = path.match(/^\/api\/memory\/([^/]+)$/))) {
      const id = decodeURIComponent(m[1]); const mem = db.memories.find(x => x.id === id);
      if (!mem) return err(404, 'Memoria nao encontrada');
      if (method === 'GET') return json(200, mem);
      if (method === 'DELETE') { db.memories = db.memories.filter(x => x.id !== id); save(); return json(200, { ok: true }); }
      if (method === 'PATCH') {
        const p = { ...(body || {}) }; if (Array.isArray(p.tags)) p.tags = p.tags.join(',');
        if (p.content !== undefined && (typeof p.content !== 'string' || !p.content.trim())) return err(400, 'content invalido');
        for (const k of ['kind', 'subject', 'content', 'tags']) if (p[k] !== undefined) mem[k] = p[k];
        if (p.enabled !== undefined) mem.enabled = !!p.enabled;
        mem.updated_at = nowIso(); save(); return json(200, mem);
      }
    }

    // arquivos
    if (path === '/api/files' && method === 'GET') return json(200, { files: db.files.slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 200), dir: [] });
    if (path === '/api/files/upload' && method === 'POST') {
      const { name, mime, data } = body || {};
      if (!name || !data) return err(400, 'name e data (base64) obrigatorios');
      if (typeof name !== 'string' || typeof data !== 'string') return err(400, 'name e data devem ser texto');
      if (Math.floor(data.length * 3 / 4) > MAX_UPLOAD + 3) return err(413, `Arquivo excede limite de ${MAX_UPLOAD} bytes`);
      if (!/^[A-Za-z0-9+/\s]*={0,2}\s*$/.test(data)) return err(400, 'data nao e base64 valido');
      if (name === '.' || name === '..' || /[\\/\0]/.test(name) || name.length > 255) return err(400, 'Nome de arquivo invalido');
      const id = newId(); const size = b64ToBytes(data).length;
      const rec = { id, name, path: id, size, mime: mime || null, kind: classify(mime, name), created_at: nowIso(), metadata: { originalName: name } };
      db.files.push(rec); db.fileData[id] = data.replace(/\s/g, ''); save(); return json(201, rec);
    }
    if (path === '/api/files/analyze' && method === 'POST') return json(200, analyzeCode(body?.code || ''));
    if ((m = path.match(/^\/api\/files\/([^/]+)(\/content)?$/))) {
      const id = decodeURIComponent(m[1]); const f = db.files.find(x => x.id === id);
      if (m[2]) {
        if (!f) return err(400, 'Arquivo nao encontrado');
        if (f.size > 200000) return err(400, 'Arquivo muito grande para leitura');
        const bytes = b64ToBytes(db.fileData[id] || '');
        if (bytes.includes(0)) return err(400, 'Arquivo binario: nao e possivel exibir como texto');
        return json(200, { id: f.id, name: f.name, size: f.size, mime: f.mime, kind: f.kind, content: new TextDecoder().decode(bytes) });
      }
      if (!f) return err(404, 'Arquivo nao encontrado');
      if (method === 'GET') return json(200, f);
      if (method === 'DELETE') { db.files = db.files.filter(x => x.id !== id); delete db.fileData[id]; save(); return json(200, { ok: true }); }
    }

    // tarefas
    if (path === '/api/tasks/agents' && method === 'GET') return json(200, AGENTS.map(({ id, name, description, available, allowedTools }) => ({ id, name, description, available, allowedTools })));
    if (path === '/api/tasks/plan' && method === 'POST') {
      if (!body?.goal) return err(400, 'goal obrigatorio');
      return json(200, { goal: body.goal, steps: await createPlan(body.goal, body) });
    }
    if (path === '/api/tasks') {
      if (method === 'GET') return json(200, db.tasks.slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, Number(q.get('limit')) || 50));
      if (method === 'POST') {
        const { goal, conversationId, provider, model, autoRun, agentId } = body || {};
        if (!goal || typeof goal !== 'string') return err(400, 'goal obrigatorio');
        let steps;
        if (agentId) { if (!agentMap[agentId]) return err(400, 'agentId desconhecido'); steps = [{ title: goal.slice(0, 200), agent: agentId, dependsOn: [] }]; }
        else steps = await createPlan(goal, { provider, model });
        const task = createTask({ goal, conversationId, plan: steps });
        if (autoRun) runTask(task.id, { provider, model }).catch(e => console.error('[task]', e.message));
        return json(201, task);
      }
    }
    if ((m = path.match(/^\/api\/tasks\/([^/]+)(\/run|\/cancel)?$/))) {
      const id = decodeURIComponent(m[1]); const t = db.tasks.find(x => x.id === id);
      if (!t) return err(404, 'Tarefa nao encontrada');
      if (!m[2] && method === 'GET') return json(200, taskView(t));
      if (m[2] === '/run' && method === 'POST') {
        try { return json(200, await runTask(id, { provider: body?.provider, model: body?.model })); }
        catch (e) { return err(e.status || 500, e.message); }
      }
      if (m[2] === '/cancel' && method === 'POST') return json(200, cancelTask(id));
    }

    // pesquisa / diagnostico / admin
    if (path === '/api/research' && method === 'POST') {
      if (!body?.query) return err(400, 'query obrigatoria');
      return err(403, 'Pesquisa web indisponivel no Executor HTML (o navegador bloqueia buscas externas). Use a versao com servidor e RESEARCH_ENABLED=true.');
    }
    if (path === '/api/diagnostics/run' && method === 'POST') return json(200, await runDiagnostics());
    if (path === '/api/diagnostics/last' && method === 'GET') return db.diag ? json(200, db.diag) : err(404, 'Nenhum diagnostico executado');
    if (path === '/api/diagnostics/export' && method === 'GET') {
      if (!db.diag) return err(404, 'Nenhum diagnostico');
      return new Response(JSON.stringify(db.diag, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (path.startsWith('/api/diagnostics/')) return err(403, 'Operacao de administrador indisponivel no Executor HTML.');

    return err(404, 'Rota nao encontrada');
  }

  // ---------- intercepta fetch ----------
  window.fetch = async function (input, init = {}) {
    const raw = typeof input === 'string' ? input : (input instanceof URL ? input.href : (input && input.url) || '');
    let pathname = null;
    if (raw.startsWith('/api/')) pathname = raw;
    else { try { const u = new URL(raw); if (/^\/api\//.test(u.pathname) && (u.origin === location.origin || u.protocol === 'file:')) pathname = u.pathname + u.search; } catch {} }
    if (pathname === null) return realFetch(input, init);
    const url = new URL(pathname, 'http://jarves.local');
    let method = (init.method || (typeof input === 'object' && input.method) || 'GET').toUpperCase();
    let rawBody = init.body; const signal = init.signal || (typeof input === 'object' ? input.signal : undefined);
    if (rawBody === undefined && typeof input === 'object' && input.clone && method !== 'GET') rawBody = await input.clone().text();
    await ready;
    let body = null;
    if (typeof rawBody === 'string' && rawBody) { try { body = JSON.parse(rawBody); } catch { return err(400, 'JSON invalido'); } }
    try { return await route(method, url.pathname.replace(/\/+$/, '') || '/', url.searchParams, body, signal); }
    catch (e) { return err(500, e.message || 'Erro interno'); }
  };

  // ---------- pre-visualizacao de arquivo (substitui /preview/:id) ----------
  const PREVIEW = new Set(['text/html', 'text/plain', 'text/css', 'text/markdown', 'application/json', 'image/png', 'image/jpeg', 'image/gif', 'image/webp']);
  const realOpen = window.open.bind(window);
  window.open = function (url, target, features) {
    const m = typeof url === 'string' && url.match(/^\/preview\/([^/?#]+)/);
    if (!m) return realOpen(url, target, features);
    const w = realOpen('about:blank', target || '_blank');
    ready.then(() => {
      const f = db.files.find(x => x.id === decodeURIComponent(m[1]));
      if (!f) { if (w) w.document.body.textContent = 'Arquivo nao encontrado'; return; }
      const mime = String(f.mime || '').split(';')[0].trim().toLowerCase();
      const bytes = b64ToBytes(db.fileData[f.id] || '');
      let blob;
      if (mime === 'text/html') {
        // HTML enviado roda em iframe isolado (sem allow-same-origin): nao alcanca os dados do JARVES.
        const html = new TextDecoder().decode(bytes).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
        blob = new Blob([`<!doctype html><meta charset="utf-8"><title>${f.name.replace(/[<&]/g, '')}</title><style>html,body,iframe{margin:0;width:100%;height:100%;border:0}</style><iframe sandbox="allow-scripts" srcdoc="${html}"></iframe>`], { type: 'text/html' });
      } else blob = new Blob([bytes], { type: PREVIEW.has(mime) ? mime : 'text/plain' });
      const u = URL.createObjectURL(blob);
      if (w) w.location.href = u; else realOpen(u, '_blank');
      setTimeout(() => URL.revokeObjectURL(u), 120000);
    });
    return w;
  };

  // ---------- links de diagnostico (/api/diagnostics/export, /diagnostico) ----------
  function diagText(r, fmt) {
    if (fmt === 'json') return [JSON.stringify(r, null, 2), 'application/json'];
    const esc = (v) => String(v ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const lines = [`JARVES AI - RELATORIO DE DIAGNOSTICO (${r.timestamp})`, '', ...Object.entries(r.summary).map(([k, v]) => `${k}: ${v}`), '', ...r.errors.map(e => `[${e.severity}] ${e.name} - ${e.probableCause}`)];
    if (fmt === 'txt') return [lines.join('\n'), 'text/plain'];
    return [`<!doctype html><meta charset="utf-8"><title>JARVES AI Diagnostico</title><body style="font-family:sans-serif;padding:20px"><pre>${esc(lines.join('\n'))}</pre></body>`, 'text/html'];
  }
  document.addEventListener('click', (ev) => {
    const a = ev.target.closest && ev.target.closest('a[href]'); if (!a) return;
    const href = a.getAttribute('href');
    const m = href.match(/^\/api\/diagnostics\/export\?format=(\w+)/);
    if (!m && href !== '/diagnostico') return;
    ev.preventDefault();
    if (!db.diag) { alert('Nenhum diagnostico executado. Rode um em Diagnostico.'); return; }
    const fmt = m ? m[1].toLowerCase() : 'html'; const [text, type] = diagText(db.diag, fmt);
    const u = URL.createObjectURL(new Blob([text], { type }));
    if (m) { const d = document.createElement('a'); d.href = u; d.download = 'diagnostico.' + fmt; d.click(); } else window.open(u, '_blank');
    setTimeout(() => URL.revokeObjectURL(u), 60000);
  });

  // ---------- backup dos dados ----------
  window.jarvesExecutor = {
    mode: 'executor-html', version: VERSION, ready,
    exportData() { const blob = new Blob([JSON.stringify({ app: 'jarves-executor', version: VERSION, exportedAt: nowIso(), db }, null, 1)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `jarves-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); },
    async importData(file) { const d = JSON.parse(await file.text()); if (d.app !== 'jarves-executor' || !d.db) throw new Error('Arquivo de backup invalido'); db = { ...emptyDb(), ...d.db }; await flush(); },
    async reset() { db = emptyDb(); save(); },
  };
  document.addEventListener('DOMContentLoaded', () => {
    const bar = document.querySelector('.sidebar-bottom'); if (!bar) return;
    const mk = (label, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'secondary-btn'; b.textContent = label; b.style.cssText = 'margin-top:6px;padding:4px 8px;font-size:12px;flex:1'; b.addEventListener('click', fn); return b; };
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'application/json'; input.hidden = true;
    input.addEventListener('change', async () => { try { await window.jarvesExecutor.importData(input.files[0]); location.reload(); } catch (e) { alert(e.message); } });
    const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:6px;flex-basis:100%;width:100%';
    row.append(mk('Backup', () => window.jarvesExecutor.exportData()), mk('Restaurar', () => input.click()), input);
    bar.style.flexWrap = 'wrap'; bar.append(row);
  });
})();
