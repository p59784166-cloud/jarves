import express from 'express';
import * as CR from '../../database/repositories/conversationRepository.mjs';
import { chatOnce, streamOnce, resolveRuntime } from '../services/aiService.mjs';
import { buildMessages } from '../services/aiService.mjs';
import { composeSystemPrompt } from '../../ai/core/profiles.mjs';

const router = express.Router();
const active = new Map(); // requestId -> AbortController

router.post('/', async (req, res) => {
  const { conversationId, message, provider, model, systemPrompt, profile = 'general', stream } = req.body || {};
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'message obrigatorio' });
  if (typeof profile !== 'string' || !['general', 'programmer', 'researcher', 'studies', 'planner', 'reviewer', 'creator'].includes(profile)) {
    return res.status(400).json({ error: 'Perfil de IA invalido.' });
  }
  if (systemPrompt !== undefined && (typeof systemPrompt !== 'string' || systemPrompt.length > 8000)) {
    return res.status(400).json({ error: 'systemPrompt deve ser texto com ate 8000 caracteres.' });
  }

  // Valida tudo ANTES de gravar qualquer coisa (antes, um 409 deixava a mensagem do usuario duplicada).
  const requestId = (typeof req.body?.requestId === 'string' && req.body.requestId.trim())
    ? req.body.requestId.trim().slice(0, 160)
    : `${conversationId || 'new'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  if (active.has(requestId)) {
    return res.status(409).json({ error: 'Ja existe uma requisicao ativa com este identificador', requestId });
  }
  let conv = conversationId ? CR.getConversation(conversationId) : null;
  if (conversationId && !conv) return res.status(404).json({ error: 'Conversa nao encontrada' });
  if (!conv) conv = CR.createConversation({ title: message.trim().slice(0, 60) || 'Nova conversa', model, provider });
  const convId = conv.id;

  if (model || provider) CR.updateConversation(convId, { model: model ?? conv.model, provider: provider ?? conv.provider });

  // Historico lido antes de gravar a nova mensagem.
  const hist = CR.listMessages(convId).filter(m => !m.error).map(m => ({ role: m.role, content: m.content }));
  CR.addMessage({ conversationId: convId, role: 'user', content: message, model, provider });
  const messages = buildMessages(composeSystemPrompt(profile, systemPrompt || ''), hist, message);

  const controller = new AbortController();
  active.set(requestId, controller);
  // Se o cliente fechar a conexao antes do fim, interrompe a geracao no provedor.
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });

  if (!stream) {
    try {
      const result = await chatOnce({ provider, model, messages, signal: controller.signal });
      const saved = CR.addMessage({ conversationId: convId, role: 'assistant', content: result.content, model: result.model, provider: result.provider });
      return res.json({ requestId, conversationId: convId, message: saved, content: result.content, model: result.model, provider: result.provider, usage: result.usage });
    } catch (e) {
      const aborted = e.name === 'AbortError' || /abort/i.test(e.message);
      CR.addMessage({ conversationId: convId, role: 'assistant', content: '', model, provider, error: e.message });
      if (res.headersSent || res.writableEnded) return;
      return res.status(aborted ? 499 : 502).json({ requestId, conversationId: convId, error: e.message, aborted });
    } finally { active.delete(requestId); }
  }

  // stream via SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  const send = (obj) => { if (!res.writableEnded && !res.destroyed) res.write(`data: ${JSON.stringify(obj)}\n\n`); };
  let full = '';
  let finalModel = model;
  let finalProvider = provider;
  try {
    for await (const chunk of streamOnce({ provider, model, messages, signal: controller.signal })) {
      if (chunk.delta) { full += chunk.delta; send({ type: 'delta', delta: chunk.delta }); }
      finalModel = chunk.model || finalModel;
      finalProvider = chunk.provider || finalProvider;
      if (chunk.done) send({ type: 'done', model: finalModel, provider: finalProvider });
    }
    const saved = CR.addMessage({ conversationId: convId, role: 'assistant', content: full, model: finalModel, provider: finalProvider });
    send({ type: 'saved', messageId: saved.id, conversationId: convId });
  } catch (e) {
    const aborted = e.name === 'AbortError' || /abort/i.test(e.message);
    send({ type: 'error', error: e.message, aborted, conversationId: convId });
    CR.addMessage({ conversationId: convId, role: 'assistant', content: full, model: finalModel, provider: finalProvider, error: aborted ? 'Interrompido' : e.message });
  } finally {
    active.delete(requestId);
    res.end();
  }
});

router.post('/cancel', (req, res) => {
  const { requestId } = req.body || {};
  if (!requestId) return res.status(400).json({ error: 'requestId obrigatorio' });
  const c = active.get(requestId);
  if (!c) return res.status(404).json({ error: 'Requisicao nao encontrada ou ja finalizada' });
  c.abort();
  res.json({ ok: true });
});

router.get('/active', (req, res) => {
  res.json({ count: active.size, ids: [...active.keys()] });
});

export default router;
export { active };
