import { env } from '../../backend/config/env.mjs';
import { withTimeout, timeoutError, trimUrl } from './http.mjs';

export class OllamaProvider {
  constructor(config = {}) {
    this.name = 'ollama';
    this.baseUrl = trimUrl(config.baseUrl || env.OLLAMA_BASE_URL);
    this.timeoutMs = config.timeoutMs || env.OLLAMA_TIMEOUT_MS;
  }

  async listModels() {
    let res;
    try { res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(10000) }); }
    catch (e) { throw new Error(`Ollama inacessivel em ${this.baseUrl}: ${e.message}`); }
    if (!res.ok) throw new Error(`Ollama indisponivel: HTTP ${res.status}`);
    const data = await res.json();
    return (data.models || []).map(m => ({
      id: m.name, name: m.name, provider: 'ollama', size: m.size, modified: m.modified_at,
      capabilities: m.details?.families || [],
    }));
  }

  async checkModel(model) {
    const models = await this.listModels();
    return models.some(m => m.id === model);
  }

  _body(model, messages, options, stream) {
    if (!model) throw new Error('Nenhum modelo Ollama selecionado. Escolha ou instale um modelo em Configuracoes > Modelos IA.');
    return JSON.stringify({
      model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      stream,
      think: false, // modelos "thinking" (qwen3.x) gastavam todos os tokens pensando e devolviam resposta vazia
      keep_alive: '30m',
      options: { temperature: options.temperature ?? 0.6, num_predict: options.maxTokens ?? 8192, num_ctx: options.numCtx ?? 16384, top_p: options.topP ?? 0.85 },
    });
  }

  async chat({ model, messages, options = {}, signal = null }) {
    const t = withTimeout(signal, this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: this._body(model, messages, options, false), signal: t.signal,
      });
      if (!res.ok) throw new Error(`Ollama erro ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const data = await res.json();
      if (data.error) throw new Error(`Ollama: ${data.error}`);
      return {
        content: data.message?.content || '', model: data.model || model, provider: 'ollama', done: data.done,
        usage: { prompt: data.prompt_eval_count, completion: data.eval_count },
      };
    } catch (e) {
      if (t.timedOut()) throw timeoutError('o Ollama', this.timeoutMs);
      throw e;
    } finally { t.cleanup(); }
  }

  async *stream({ model, messages, options = {}, signal = null }) {
    const t = withTimeout(signal, this.timeoutMs); // timeout de INATIVIDADE: reinicia a cada pedaco recebido
    let finished = false;
    try {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: this._body(model, messages, options, true), signal: t.signal,
      });
      if (!res.ok) throw new Error(`Ollama erro ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const handle = function* (line) {
        const trimmed = line.trim();
        if (!trimmed) return;
        let obj;
        try { obj = JSON.parse(trimmed); } catch { return; }
        if (obj.error) throw new Error(`Ollama: ${obj.error}`);
        if (obj.message?.content) yield { delta: obj.message.content, model: obj.model || model, provider: 'ollama', done: false };
        if (obj.done) { finished = true; yield { delta: '', model: obj.model || model, provider: 'ollama', done: true }; }
      };
      while (!finished) {
        const { value, done } = await reader.read();
        if (done) break;
        t.touch();
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) { yield* handle(line); if (finished) break; }
      }
      if (!finished && buffer.trim()) yield* handle(buffer); // ultima linha sem \n
    } catch (e) {
      if (t.timedOut()) throw timeoutError('resposta do Ollama', this.timeoutMs);
      throw e;
    } finally { t.cleanup(); }
  }
}
