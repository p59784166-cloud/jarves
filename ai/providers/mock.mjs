export class MockProvider {
  constructor(config = {}) {
    this.name = 'mock';
    this.delayMs = config.delayMs ?? 50;
    this.response = config.response ?? 'Resposta simulada do JARVES AI.';
    this.fail = config.fail ?? false;
    this.models = config.models ?? ['mock-model-1'];
  }
  async listModels() { return this.models.map(id => ({ id, name: id, provider: 'mock' })); }
  async checkModel(model) { return this.models.includes(model); }
  async chat({ model, messages, signal = null }) {
    await new Promise((resolve, reject) => {
      const t = setTimeout(resolve, this.delayMs);
      if (signal) signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('abortado')); }, { once: true });
    });
    if (this.fail) throw new Error('Falha simulada do provedor');
    const last = messages[messages.length - 1]?.content || '';
    return { content: `${this.response} [eco: ${last.slice(0, 80)}]`, model: model || this.models[0], provider: 'mock', done: true };
  }
  async *stream({ model, messages, signal = null }) {
    const r = await this.chat({ model, messages, signal });
    // stream in chunks
    const parts = r.content.match(/.{1,20}/g) || [r.content];
    for (const p of parts) {
      await new Promise(res => setTimeout(res, 10));
      yield { delta: p, model: r.model, provider: 'mock', done: false };
    }
    yield { delta: '', model: r.model, provider: 'mock', done: true };
  }
}
