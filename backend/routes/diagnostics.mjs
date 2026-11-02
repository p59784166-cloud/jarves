import express from 'express';
import { runDiagnostics, getLastReport, exportReport, applyFix, createBackup } from '../services/diagnosticsService.mjs';
import { requireAdmin } from '../middleware/security.mjs';

const router = express.Router();

router.post('/run', async (req, res) => {
  try {
    const report = await runDiagnostics({ runTests: req.body?.runTests === true });
    res.json(report);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/last', (req, res) => {
  const r = getLastReport();
  if (!r) return res.status(404).json({ error: 'Nenhum diagnostico executado' });
  res.json(r);
});

router.get('/export', (req, res) => {
  const format = String(req.query.format || 'json').toLowerCase();
  const content = exportReport(format);
  if (!content) return res.status(404).json({ error: 'Nenhum diagnostico' });
  const ct = format === 'html' ? 'text/html' : (format === 'txt' ? 'text/plain' : 'application/json');
  res.setHeader('Content-Type', ct);
  res.setHeader('Content-Disposition', `attachment; filename="diagnostico.${format}"`);
  res.send(content);
});

router.post('/fix', requireAdmin, async (req, res) => {
  const { filePath, find, replace, runTests } = req.body || {};
  if (!filePath || !find || replace === undefined) return res.status(400).json({ error: 'filePath, find, replace obrigatorios' });
  try {
    const r = await applyFix({ filePath, find, replace, runTests: runTests === true });
    res.json(r);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/backup', requireAdmin, (req, res) => {
  const { filePath } = req.body || {};
  if (!filePath) return res.status(400).json({ error: 'filePath obrigatorio' });
  try {
    const b = createBackup(filePath);
    if (!b) return res.status(404).json({ error: 'Arquivo nao encontrado' });
    res.json({ ok: true, backup: b });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

export default router;
