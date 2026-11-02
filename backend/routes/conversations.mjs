import express from 'express';
import * as CR from '../../database/repositories/conversationRepository.mjs';

const router = express.Router();

router.get('/', (req, res) => {
  const { limit, offset, search } = req.query;
  res.json(CR.listConversations({ limit: Number(limit) || 100, offset: Number(offset) || 0, search: search || '' }));
});

router.post('/', (req, res) => {
  const { title, model, provider, agentId } = req.body || {};
  const c = CR.createConversation({ title: title || 'Nova conversa', model, provider, agentId });
  res.status(201).json(c);
});

router.post('/unify', (req, res) => {
  const result = CR.unifyConversations();
  if (!result) return res.status(400).json({ error: 'Ainda não há mensagens para reunir em um chat.' });
  res.json(result);
});

router.get('/:id', (req, res) => {
  const c = CR.getConversation(req.params.id);
  if (!c) return res.status(404).json({ error: 'Conversa nao encontrada' });
  res.json({ ...c, messages: CR.listMessages(req.params.id) });
});

router.patch('/:id', (req, res) => {
  const c = CR.updateConversation(req.params.id, req.body || {});
  if (!c) return res.status(404).json({ error: 'Conversa nao encontrada' });
  res.json(c);
});

router.delete('/:id', (req, res) => {
  const ok = CR.deleteConversation(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Conversa nao encontrada' });
  res.json({ ok: true });
});

router.get('/:id/messages', (req, res) => {
  if (!CR.getConversation(req.params.id)) return res.status(404).json({ error: 'Conversa nao encontrada' });
  res.json(CR.listMessages(req.params.id));
});

router.post('/:id/messages', (req, res) => {
  const { role, content, model, provider, error } = req.body || {};
  if (!role || content === undefined) return res.status(400).json({ error: 'role e content obrigatorios' });
  if (!['user', 'assistant', 'system'].includes(role)) return res.status(400).json({ error: 'role invalido' });
  if (!CR.getConversation(req.params.id)) return res.status(404).json({ error: 'Conversa nao encontrada' });
  const m = CR.addMessage({ conversationId: req.params.id, role, content, model, provider, error });
  res.status(201).json(m);
});

router.delete('/:id/messages', (req, res) => {
  if (!CR.getConversation(req.params.id)) return res.status(404).json({ error: 'Conversa nao encontrada' });
  CR.deleteMessages(req.params.id);
  res.json({ ok: true });
});

export default router;
