import express from 'express';
import { listAvailableModels } from '../services/aiService.mjs';
import { checkModel } from '../services/aiService.mjs';
import { getSetting } from '../../database/repositories/settingsRepository.mjs';

const router = express.Router();

router.get('/', async (req, res) => {
  const provider = req.query.provider || null;
  const result = await listAvailableModels(provider);
  res.json(result);
});


router.post('/pull', async (req, res) => {
  const { model } = req.body || {};
  if (typeof model !== 'string' || !/^[a-zA-Z0-9._:/-]{1,160}$/.test(model)) {
    return res.status(400).json({ error: 'Nome de modelo inválido.' });
  }
  const baseUrl = getSetting('ollama_base_url', null) || process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
  let endpoint;
  try { endpoint = new URL('/api/pull', baseUrl); }
  catch { return res.status(400).json({ error: 'URL do Ollama inválida.' }); }
  if (!['http:', 'https:'].includes(endpoint.protocol)) return res.status(400).json({ error: 'Protocolo do Ollama inválido.' });
  try {
    const response = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, stream: false }), signal: AbortSignal.timeout(30 * 60 * 1000),
    });
    if (!response.ok) {
      const detail = await response.text();
      return res.status(response.status).json({ error: `Ollama não conseguiu baixar o modelo: ${detail.slice(0, 240)}` });
    }
    const result = await response.json().catch(() => ({}));
    res.json({ ok: true, model, status: result.status || 'sucesso' });
  } catch (error) {
    res.status(502).json({ error: error.name === 'TimeoutError' ? 'Tempo limite ao baixar o modelo.' : `Não foi possível acessar Ollama: ${error.message}` });
  }
});

router.get('/check', async (req, res) => {
  const { provider, model } = req.query;
  if (!provider || !model) return res.status(400).json({ error: 'provider e model obrigatorios' });
  try {
    const ok = await checkModel(provider, model);
    res.json({ provider, model, available: ok });
  } catch (e) {
    res.json({ provider, model, available: false, error: e.message });
  }
});

export default router;
