export class BaseAgent {
  constructor(spec) {
    this.id = spec.id;
    this.name = spec.name;
    this.description = spec.description;
    this.systemPrompt = spec.systemPrompt;
    this.allowedTools = spec.allowedTools || [];
    this.model = spec.model || null;
    this.provider = spec.provider || null;
    this.maxSteps = spec.maxSteps || 5;
    this.timeoutMs = spec.timeoutMs || 120000;
    this.available = true;
  }
  async run({ task, context = {}, aiService, signal = null, onStep = null }) {
    throw new Error('run() not implemented');
  }
}
