import '../../executor/base-engine.js';

export const BASE_MODEL = 'jarves-base';

// IA base offline: funciona sem Ollama e sem internet.
export class BaseProvider {
  constructor(config = {}) { this.name = 'base'; this.delayMs = config.delayMs ?? 8; }
  async listModels() { return [{ id: BASE_MODEL, name: BASE_MODEL, provider: 'base' }]; }
  async checkModel(model) { return !model || model === BASE_MODEL; }
  async chat({ messages }) {
    return { content: globalThis.JARVES_BASE.reply(messages), model: BASE_MODEL, provider: 'base', done: true };
  }
  async *stream({ messages, signal = null }) {
    const text = globalThis.JARVES_BASE.reply(messages);
    for (let i = 0; i < text.length; i += 48) {
      if (signal?.aborted) throw new Error('abortado');
      await new Promise(r => setTimeout(r, this.delayMs));
      yield { delta: text.slice(i, i + 48), model: BASE_MODEL, provider: 'base', done: false };
    }
    yield { delta: '', model: BASE_MODEL, provider: 'base', done: true };
  }
}
