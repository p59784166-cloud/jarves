import { BaseAgent } from './baseAgent.mjs';
import { chatOnce } from '../../backend/services/aiService.mjs';

export class GenericAgent extends BaseAgent {
  async run({ task, context = {}, history = [], signal = null }) {
    const messages = [];
    if (this.systemPrompt) messages.push({ role: 'system', content: this.systemPrompt });
    for (const h of history) messages.push({ role: h.role, content: h.content });
    messages.push({ role: 'user', content: task });
    const steps = [];
    steps.push({ idx: 0, title: 'Chamada ao modelo', status: 'running' });
    try {
      const res = await chatOnce({
        provider: this.provider || context.provider || null,
        model: this.model || context.model || null,
        messages,
        signal,
        options: context.temperature !== undefined ? { temperature: context.temperature } : {},
      });
      steps[0].status = 'done';
      steps[0].output = res.content?.slice(0, 200);
      return { agentId: this.id, agentName: this.name, content: res.content, model: res.model, provider: res.provider, steps };
    } catch (e) {
      steps[0].status = 'failed';
      steps[0].error = e.message;
      throw e;
    }
  }
}
