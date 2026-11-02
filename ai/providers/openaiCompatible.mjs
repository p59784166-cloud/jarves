import { env } from '../../backend/config/env.mjs';
import { withTimeout, timeoutError, trimUrl } from './http.mjs';

export class OpenAICompatibleProvider {
  constructor(config = {}) {
    this.name = 'openai-compatible';
    this.baseUrl = trimUrl(config.baseUrl || env.OPENAI_COMPAT_BASE_URL);
    this.apiKey = config.apiKey || env.OPENAI_COMPAT_API_KEY || '';
    this.model = config.model || env.OPENAI_COMPAT_MODEL || '';
    this.timeoutMs = config.timeoutMs || env.OLLAMA_TIMEOUT_MS;
  }

  isConfigured() { return Boolean(this.baseUrl && this.apiKey && this.model); }
  _headers() { return { 'Content-Type': 'application/json', ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}) }; }

  async listModels() {
    if (!this.baseUrl) return [];
    let res;
    try { res = await fetch(`${this.baseUrl}/models`, { headers: this._headers(), signal: AbortSignal.timeout(10000) }); }
    catch (e) { throw new Error(`Provedor externo inacessivel em ${this.baseUrl}: ${e.message}`); }
    if (!res.ok) throw new Error(`Provedor externo indisponivel: HTTP ${res.status}`);
    const data = await res.json();
    const arr = data.data || data.models || [];
    return arr.map(m => ({ id: m.id || m.name, name: m.id || m.name, provider: 'openai-compatible' }));
  }

  _body(model, messages, options, stream) {
    const body = {
      model, stream,
      messages: messages.map(x => ({ role: x.role, content: x.content })),
    };
    if (model === 'gpt-6.1-sol') {
      body.max_completion_tokens = options.maxTokens ?? 512;
      body.reasoning_effort = 'medium';
    } else {
      body.temperature = options.temperature ?? 0.6;
      body.max_tokens = options.maxTokens ?? 512;
      body.top_p = options.topP ?? 0.85;
    }
    return JSON.stringify(body);
  }
  _model(model) {
    if (!this.baseUrl) throw new Error('Endpoint do provedor externo nao configurado (Configuracoes > Conexao)');
    const m = model || this.model;
    if (!m) throw new Error('Modelo externo nao configurado');
    return m;
  }

  async chat({ model, messages, options = {}, signal = null }) {
    const m = this._model(model);
    const t = withTimeout(signal, this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, { method: 'POST', headers: this._headers(), body: this._body(m, messages, options, false), signal: t.signal });
      if (!res.ok) throw new Error(`Provedor externo erro ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const data = await res.json();
      return { content: data.choices?.[0]?.message?.content || '', model: data.model || m, provider: 'openai-compatible', done: true, usage: data.usage };
    } catch (e) {
      if (t.timedOut()) throw timeoutError('o provedor externo', this.timeoutMs);
      throw e;
    } finally { t.cleanup(); }
  }

  // Streaming real (SSE "data: {...}" / "data: [DONE]").
  async *stream({ model, messages, options = {}, signal = null }) {
    const m = this._model(model);
    const t = withTimeout(signal, this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, { method: 'POST', headers: this._headers(), body: this._body(m, messages, options, true), signal: t.signal });
      if (!res.ok) throw new Error(`Provedor externo erro ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const ctype = res.headers.get('content-type') || '';
      if (!ctype.includes('text/event-stream')) { // provedor ignorou stream:true
        const data = await res.json();
        yield { delta: data.choices?.[0]?.message?.content || '', model: data.model || m, provider: 'openai-compatible', done: true };
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = ''; let usedModel = m;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        t.touch();
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const raw of lines) {
          const line = raw.trim();
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') { yield { delta: '', model: usedModel, provider: 'openai-compatible', done: true }; return; }
          let obj; try { obj = JSON.parse(payload); } catch { continue; }
          if (obj.error) throw new Error(`Provedor externo: ${obj.error.message || JSON.stringify(obj.error)}`);
          usedModel = obj.model || usedModel;
          const delta = obj.choices?.[0]?.delta?.content;
          if (delta) yield { delta, model: usedModel, provider: 'openai-compatible', done: false };
        }
      }
      yield { delta: '', model: usedModel, provider: 'openai-compatible', done: true };
    } catch (e) {
      if (t.timedOut()) throw timeoutError('resposta do provedor externo', this.timeoutMs);
      throw e;
    } finally { t.cleanup(); }
  }
}
