import { OllamaProvider } from './ollama.mjs';
import { BaseProvider, BASE_MODEL } from './base.mjs';

// Automatico: usa o Ollama quando ele esta ligado e cai para a IA base quando nao esta.
export class AutoProvider {
  constructor(config = {}) {
    this.name = 'auto';
    this.config = config;
    this.ollama = new OllamaProvider(config);
    this.base = new BaseProvider();
  }
  async listModels() {
    let models = [];
    try { models = await this.ollama.listModels(); } catch { /* Ollama desligado: so a IA base */ }
    return [...models, ...(await this.base.listModels())];
  }
  async checkModel(model) { return model === BASE_MODEL || this.ollama.checkModel(model).catch(() => false); }
  async _pick(model) {
    if (model === BASE_MODEL) return { p: this.base, model: BASE_MODEL };
    try {
      const list = await this.ollama.listModels();
      if (!list.length) return { p: this.base, model: BASE_MODEL };
      return { p: this.ollama, model: list.some(m => m.id === model) ? model : list[0].id };
    } catch { return { p: this.base, model: BASE_MODEL }; }
  }
  async chat(args) {
    const { p, model } = await this._pick(args.model);
    return p.chat({ ...args, model });
  }
  async *stream(args) {
    const { p, model } = await this._pick(args.model);
    yield* p.stream({ ...args, model });
  }
}
