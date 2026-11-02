import express from 'express';
import { searchWeb } from '../services/researchService.mjs';

const router = express.Router();

router.post('/', async (req, res) => {
  const { query, limit } = req.body || {};
  if (!query) return res.status(400).json({ error: 'query obrigatoria' });
  try {
    const r = await searchWeb(query, Number(limit) || 8);
    res.json(r);
  } catch (e) { res.status(e.status || 502).json({ error: e.message }); }
});

export default router;
