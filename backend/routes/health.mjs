import express from 'express';
import { getDb } from '../services/db.mjs';
import { APP_VERSION } from '../config/env.mjs';

const router = express.Router();

router.get('/', (req, res) => {
  let dbOk = true;
  try { getDb().prepare('SELECT 1').get(); } catch { dbOk = false; }
  res.json({ status: 'ok', db: dbOk, time: new Date().toISOString(), version: APP_VERSION });
});

export default router;
