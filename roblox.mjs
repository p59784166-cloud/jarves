import crypto from 'node:crypto';
import net from 'node:net';
import express from 'express';

const router = express.Router();
const MAX_PENDING_SCRIPTS = 8;
const MAX_SOURCE_BYTES = 64 * 1024;
const TARGETS = Object.freeze({
  ServerScriptService: 'Script',
  StarterPlayerScripts: 'LocalScript',
  ReplicatedStorage: 'ModuleScript',
});

let bridgeToken = null;
const pendingScripts = [];

function isLoopback(req) {
  const address = String(req.socket?.remoteAddress || '').toLowerCase();
  if (address === '::1') return true;
  const ipv4 = address.startsWith('::ffff:') ? address.slice(7) : address;
  return net.isIP(ipv4) === 4 && ipv4.startsWith('127.');
}

function requireLoopback(req, res, next) {
  if (!isLoopback(req)) return res.status(403).json({ error: 'A ponte Roblox aceita apenas conexões locais.' });
  next();
}

function tokenMatches(provided) {
  if (typeof provided !== 'string' || !bridgeToken) return false;
  const suppliedDigest = crypto.createHash('sha256').update(provided).digest();
  const expectedDigest = crypto.createHash('sha256').update(bridgeToken).digest();
  return crypto.timingSafeEqual(suppliedDigest, expectedDigest);
}

function requireBridgeToken(req, res, next) {
  if (!isLoopback(req)) return res.status(403).json({ error: 'A ponte Roblox aceita apenas conexões locais.' });
  if (!tokenMatches(req.get('X-Jarves-Bridge-Token'))) return res.status(403).json({ error: 'Token da ponte Roblox inválido ou expirado.' });
  next();
}

router.post('/pair', requireLoopback, (req, res) => {
  bridgeToken = crypto.randomBytes(32).toString('hex');
  pendingScripts.length = 0;
  res.json({ token: bridgeToken, expiresOnRestart: true });
});

router.get('/status', requireBridgeToken, (req, res) => {
  res.json({ ok: true, queued: pendingScripts.length });
});

router.post('/queue', requireBridgeToken, (req, res) => {
  const { name, target, source } = req.body || {};
  if (typeof name !== 'string' || !/^[A-Za-z][A-Za-z0-9_ ]{0,47}$/.test(name.trim())) {
    return res.status(400).json({ error: 'Nome inválido. Use até 48 letras, números, espaços ou _.' });
  }
  if (!Object.hasOwn(TARGETS, target)) return res.status(400).json({ error: 'Destino de script inválido.' });
  if (typeof source !== 'string' || !source.trim()) return res.status(400).json({ error: 'O código Luau não pode ficar vazio.' });
  if (Buffer.byteLength(source, 'utf8') > MAX_SOURCE_BYTES) return res.status(413).json({ error: 'O código Luau excede o limite de 64 KB.' });
  if (pendingScripts.length >= MAX_PENDING_SCRIPTS) return res.status(429).json({ error: 'Fila cheia. Aguarde o Studio inserir ou descartar os scripts pendentes.' });

  const script = {
    id: crypto.randomUUID(),
    name: name.trim(),
    target,
    className: TARGETS[target],
    source,
    createdAt: new Date().toISOString(),
  };
  pendingScripts.push(script);
  res.status(201).json({ ok: true, id: script.id, queued: pendingScripts.length });
});

router.get('/next', requireBridgeToken, (req, res) => {
  res.json({ script: pendingScripts[0] || null });
});

router.post('/ack', requireBridgeToken, (req, res) => {
  const { id, action } = req.body || {};
  if (typeof id !== 'string' || !['inserted', 'dismissed'].includes(action)) {
    return res.status(400).json({ error: 'Confirmação inválida.' });
  }
  const index = pendingScripts.findIndex(script => script.id === id);
  if (index === -1) return res.status(404).json({ error: 'Script pendente não encontrado.' });
  pendingScripts.splice(index, 1);
  res.json({ ok: true, action, queued: pendingScripts.length });
});

export default router;
