import express from 'express';
import * as S from '../../database/repositories/settingsRepository.mjs';
import { env } from '../config/env.mjs';
import { DEFAULT_IMAGE_GENERATOR_URL, validateImageGeneratorUrl } from '../services/imageGenerationService.mjs';

const router = express.Router();

const ALLOWED = new Set([
  'ai_provider','ollama_base_url','ollama_model','openai_base_url','openai_api_key','openai_model','ai_timeout_ms',
  'theme','language','memory_enabled','max_upload_bytes','research_enabled','ai_quality','image_gen_url',
]);

router.get('/', (req, res) => {
  const all = S.getAllSettings();
  // mask secret
  if (all.openai_api_key) all.openai_api_key = '***' + String(all.openai_api_key).slice(-4);
  res.json({ settings: all, defaults: { ai_provider: env.AI_PROVIDER, ollama_base_url: env.OLLAMA_BASE_URL, ollama_model: env.OLLAMA_MODEL, research_enabled: String(env.RESEARCH_ENABLED), image_gen_url: DEFAULT_IMAGE_GENERATOR_URL } });
});

router.get('/:key', (req, res) => {
  if (!ALLOWED.has(req.params.key)) return res.status(404).json({ error: 'Configuracao nao encontrada' });
  const v = S.getSetting(req.params.key, null);
  const safeValue = req.params.key === 'openai_api_key' && v ? '***' + String(v).slice(-4) : v;
  res.json({ key: req.params.key, value: safeValue });
});

router.put('/:key', (req, res) => {
  const { key } = req.params;
  if (!ALLOWED.has(key)) return res.status(400).json({ error: 'Chave nao permitida' });
  const { value } = req.body || {};
  if (value === undefined) return res.status(400).json({ error: 'value obrigatorio' });
  if (!['string', 'number', 'boolean'].includes(typeof value)) return res.status(400).json({ error: 'value deve ser texto, numero ou booleano' });
  // Valor vazio = voltar ao padrao (remove a configuracao). Antes, salvar o formulario com um campo
  // em branco (tempo limite, qualidade, provedor) falhava com 400 e a tela nunca salvava na 1a vez.
  if (value === '') { S.deleteSetting(key); return res.json({ ok: true, key, value: null, cleared: true }); }
  // The UI receives a masked secret. Never overwrite a real key with its mask.
  if (key === 'openai_api_key' && typeof value === 'string' && /^\*{3,}/.test(value)) {
    return res.json({ ok: true, key, preserved: true });
  }
  if (['ollama_base_url', 'openai_base_url'].includes(key) && value) {
    try { const u = new URL(String(value)); if (!['http:', 'https:'].includes(u.protocol)) throw new Error(); }
    catch { return res.status(400).json({ error: 'URL invalida: use http:// ou https://' }); }
  }
  if (key === 'image_gen_url' && value) {
    try { validateImageGeneratorUrl(value); }
    catch (error) { return res.status(400).json({ error: error.message }); }
  }
  if (key === 'openai_api_key' && (typeof value !== 'string' || value.length > 4096)) return res.status(400).json({ error: 'API key invalida' });
  if (key === 'ai_timeout_ms' && Number(value) > 600000) return res.status(400).json({ error: 'timeout maximo: 600000 ms' });
  // validation
  if (key === 'ai_timeout_ms' && (isNaN(Number(value)) || Number(value) < 1000)) return res.status(400).json({ error: 'timeout invalido' });
  if (key === 'ai_provider' && !['auto','ollama','openai-compatible','base','mock'].includes(value)) return res.status(400).json({ error: 'provedor invalido' });
  if (key === 'ai_quality' && !['low','medium','high'].includes(value)) return res.status(400).json({ error: 'qualidade invalida' });
  S.setSetting(key, value);
  res.json({ ok: true, key, value: key === 'openai_api_key' ? '***' + String(value).slice(-4) : value });
});

router.delete('/:key', (req, res) => {
  if (!ALLOWED.has(req.params.key)) return res.status(400).json({ error: 'Chave nao permitida' });
  S.deleteSetting(req.params.key);
  res.json({ ok: true });
});

export default router;
