import crypto from 'node:crypto';
import { env } from '../config/env.mjs';

export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(self)');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  next();
}

// CORS so e enviado quando CORS_ORIGIN estiver configurado (lista separada por virgula, ou *).
export function cors(req, res, next) {
  const allowed = env.CORS_ORIGIN.split(',').map(s => s.trim()).filter(Boolean);
  const origin = req.headers.origin;
  if (allowed.length && origin) {
    if (allowed.includes('*') || allowed.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', allowed.includes('*') ? '*' : origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Admin-Token');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
  }
  next();
}

function tokenMatches(provided) {
  if (typeof provided !== 'string' || !env.ADMIN_TOKEN) return false;
  const a = crypto.createHash('sha256').update(provided).digest();
  const b = crypto.createHash('sha256').update(env.ADMIN_TOKEN).digest();
  return crypto.timingSafeEqual(a, b);
}

// Sem ADMIN_TOKEN configurado a rota fica aberta (uso local). O token nunca e aceito na URL.
export function adminGuard(req, res, next) {
  if (!env.ADMIN_TOKEN) return next();
  if (!tokenMatches(req.headers['x-admin-token'])) return res.status(403).json({ error: 'Acesso administrativo negado' });
  next();
}

// Para operacoes perigosas (editar arquivos do programa): exige ADMIN_TOKEN configurado E enviado.
export function requireAdmin(req, res, next) {
  if (!env.ADMIN_TOKEN) return res.status(403).json({ error: 'Operacao desativada: defina ADMIN_TOKEN no .env para habilitar.' });
  if (!tokenMatches(req.headers['x-admin-token'])) return res.status(403).json({ error: 'Acesso administrativo negado' });
  next();
}

export function errorHandler(err, req, res, next) {
  console.error('[ERR]', err?.message);
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: status === 500 && env.NODE_ENV === 'production' ? 'Erro interno' : (err.message || 'Erro interno'), code: err.code || 'INTERNAL' });
}
