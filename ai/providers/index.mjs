import { OllamaProvider } from './ollama.mjs';
import { OpenAICompatibleProvider } from './openaiCompatible.mjs';
import { MockProvider } from './mock.mjs';
import { BaseProvider } from './base.mjs';
import { AutoProvider } from './auto.mjs';
import { env } from '../../backend/config/env.mjs';

export function createProvider(name, config = {}) {
  switch (name) {
    case 'ollama': return new OllamaProvider(config);
    case 'openai-compatible':
    case 'openai': return new OpenAICompatibleProvider(config);
    case 'mock': return new MockProvider(config);
    case 'base': return new BaseProvider(config);
    case 'auto': return new AutoProvider(config);
    default: throw new Error(`Provedor desconhecido: ${name}`);
  }
}

export function defaultProviderName() {
  return env.AI_PROVIDER || 'auto';
}

export function createDefaultProvider() {
  return createProvider(defaultProviderName());
}

export const PROVIDER_NAMES = ['auto', 'ollama', 'openai-compatible', 'base', 'mock'];
