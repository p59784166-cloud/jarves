import express from 'express';
import { listProfiles } from '../../ai/core/profiles.mjs';

const router = express.Router();
router.get('/', (_req, res) => res.json({ profiles: listProfiles() }));
export default router;
