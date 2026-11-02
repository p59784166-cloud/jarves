import express from 'express';
import * as M from '../../database/repositories/memoryRepository.mjs';
import { env } from '../config/env.mjs';

const router = express.Router();

router.get('/', (req, res) => {
  const { kind, enabled, limit, offset } = req.query;
  const en = enabled === undefined ? null : enabled === 'true';
  res.json(M.listMemories({ kind: kind || null, enabled: en, limit: Number(limit) || 200, offset: Number(offset) || 0 }));
});

router.post('/', (req, res) => {
  const { kind, subject, content, tags, enabled } = req.body || {};
  if (!content) return res.status(400).json({ error: 'content obrigatorio' });
  try {
    const m = M.createMemory({ kind, subject, content, tags: Array.isArray(tags) ? tags.join(',') : tags, enabled });
    res.status(201).json(m);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.get('/search', (req, res) => {
  const q = req.query.q || '';
  res.json(M.searchMemories(q));
});

router.get('/status', (req, res) => {
  res.json({ enabled: env.MEMORY_ENABLED });
});

router.get('/:id', (req, res) => {
  const m = M.getMemory(req.params.id);
  if (!m) return res.status(404).json({ error: 'Memoria nao encontrada' });
  res.json(m);
});

router.patch('/:id', (req, res) => {
  const patch = { ...(req.body || {}) };
  if (Array.isArray(patch.tags)) patch.tags = patch.tags.join(',');
  if (patch.content !== undefined && (typeof patch.content !== 'string' || !patch.content.trim())) return res.status(400).json({ error: 'content invalido' });
  const m = M.updateMemory(req.params.id, patch);
  if (!m) return res.status(404).json({ error: 'Memoria nao encontrada' });
  res.json(m);
});

router.delete('/:id', (req, res) => {
  const ok = M.deleteMemory(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Memoria nao encontrada' });
  res.json({ ok: true });
});

router.post('/clear', (req, res) => {
  M.clearMemories();
  res.json({ ok: true });
});

export default router;
