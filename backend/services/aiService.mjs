import { createProvider } from '../../ai/providers/index.mjs';
import { getSetting } from '../../database/repositories/settingsRepository.mjs';

export function getQualityOptions() {
  // Padrao 'medium': o antigo padrao 'low' cortava TODAS as respostas em 128 tokens.
  const q = getSetting('ai_quality', null) || process.env.AI_QUALITY || 'medium';
  if (q === 'low') return { temperature: 0.5, maxTokens: 2048 };
  if (q === 'high') return { temperature: 0.7, maxTokens: 16384 };
  return { temperature: 0.7, maxTokens: 8192 };
}

export function resolveRuntime(providerOverride = null, modelOverride = null) {
  const providerName = providerOverride || getSetting('ai_provider', null) || (process.env.AI_PROVIDER || 'auto');
  const timeout = Number(getSetting('ai_timeout_ms', null)) || Number(process.env.OLLAMA_TIMEOUT_MS) || 120000;
  const config = { timeoutMs: timeout };
  let preferredModel = null;
  if (providerName === 'ollama' || providerName === 'auto') {
    const baseUrl = getSetting('ollama_base_url', null) || process.env.OLLAMA_BASE_URL;
    const model = getSetting('ollama_model', null) || process.env.OLLAMA_MODEL;
    if (baseUrl) config.baseUrl = baseUrl;
    preferredModel = model;
  } else if (providerName === 'openai-compatible') {
    const baseUrl = getSetting('openai_base_url', null) || process.env.OPENAI_COMPAT_BASE_URL;
    const apiKey = getSetting('openai_api_key', null) || process.env.OPENAI_COMPAT_API_KEY;
    const model = getSetting('openai_model', null) || process.env.OPENAI_COMPAT_MODEL;
    if (baseUrl) config.baseUrl = baseUrl;
    if (apiKey) config.apiKey = apiKey;
    preferredModel = model;
  }
  const model = modelOverride || preferredModel || null;
  const provider = createProvider(providerName, config);
  return { providerName, provider, model, config, preferredModel };
}

export async function checkModel(providerName, modelName, config = {}) {
  const { config: resolvedConfig } = resolveRuntime(providerName, null);
  const merged = { ...resolvedConfig, ...config };
  const provider = createProvider(providerName, merged);
  if (typeof provider.checkModel === 'function') return provider.checkModel(modelName);
  const models = await provider.listModels();
  return models.some(m => m.id === modelName);
}

export async function listAvailableModels(providerOverride = null) {
  const { providerName, provider, preferredModel } = resolveRuntime(providerOverride, null);
  try {
    const models = await provider.listModels();
    return { provider: providerName, models, selected: preferredModel || null, error: null };
  } catch (e) {
    return { provider: providerName, models: [], selected: preferredModel || null, error: e.message };
  }
}

export function buildMessages(systemPrompt, history, userMessage) {
  const msgs = [];
  if (systemPrompt) msgs.push({ role: 'system', content: systemPrompt });
  for (const h of history || []) {
    if (h.role && h.content) msgs.push({ role: h.role, content: h.content });
  }
  if (userMessage) msgs.push({ role: 'user', content: userMessage });
  return msgs;
}

export async function chatOnce({ provider: providerOverride = null, model = null, messages, options = {}, signal = null }) {
  const { providerName, provider, model: resolvedModel } = resolveRuntime(providerOverride, model);
  const finalModel = model || resolvedModel;
  const mergedOptions = { ...getQualityOptions(), ...options };
  const result = await provider.chat({ model: finalModel, messages, options: mergedOptions, signal });
  return { ...result, provider: result.provider || providerName, model: result.model || finalModel };
}

export async function *streamOnce({ provider: providerOverride = null, model = null, messages, options = {}, signal = null }) {
  const { providerName, provider, model: resolvedModel } = resolveRuntime(providerOverride, model);
  const finalModel = model || resolvedModel;
  const mergedOptions = { ...getQualityOptions(), ...options };
  for await (const chunk of provider.stream({ model: finalModel, messages, options: mergedOptions, signal })) {
    yield { ...chunk, provider: chunk.provider || providerName, model: chunk.model || finalModel };
  }
}
