import express from 'express';
import { generateImage, getImageGeneratorStatus } from '../services/imageGenerationService.mjs';

const router = express.Router();

router.get('/status', async (_req, res) => {
  try { res.json(await getImageGeneratorStatus()); }
  catch (error) { res.status(error.status || 503).json({ available: false, error: error.message }); }
});

router.post('/generate', async (req, res) => {
  try { res.json(await generateImage(req.body || {})); }
  catch (error) { res.status(error.status || 502).json({ error: error.message }); }
});

export default router;
