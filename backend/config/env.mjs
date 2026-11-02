import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Resolve the application root from this module, never from process.cwd().
// This keeps the backend working when launched by Electron or a desktop shortcut.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: path.join(root, '.env') });

function num(name, def) {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function bool(name, def) {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  return v === 'true' || v === '1' || v === 'yes';
}

export const APP_VERSION = '2.3.7';

export const env = {
  PORT: num('PORT', 3000),
  HOST: process.env.HOST || '0.0.0.0',
  NODE_ENV: process.env.NODE_ENV || 'development',
  AI_PROVIDER: process.env.AI_PROVIDER || 'auto',
  OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
  OLLAMA_MODEL: process.env.OLLAMA_MODEL || 'qwen3.5:4b',
  OLLAMA_TIMEOUT_MS: num('OLLAMA_TIMEOUT_MS', 120000),
  OPENAI_COMPAT_BASE_URL: process.env.OPENAI_COMPAT_BASE_URL || '',
  OPENAI_COMPAT_API_KEY: process.env.OPENAI_COMPAT_API_KEY || '',
  OPENAI_COMPAT_MODEL: process.env.OPENAI_COMPAT_MODEL || '',
  DB_PATH: process.env.DB_PATH || './data/jarves.db',
  MEMORY_ENABLED: bool('MEMORY_ENABLED', true),
  MEMORY_MAX_ITEMS: num('MEMORY_MAX_ITEMS', 5000),
  UPLOAD_DIR: process.env.UPLOAD_DIR || './data/uploads',
  MAX_UPLOAD_BYTES: num('MAX_UPLOAD_BYTES', 512 * 1024 * 1024),
  RESEARCH_ENABLED: bool('RESEARCH_ENABLED', false),
  RESEARCH_API_KEY: process.env.RESEARCH_API_KEY || '',
  ADMIN_TOKEN: process.env.ADMIN_TOKEN || '',
  CORS_ORIGIN: process.env.CORS_ORIGIN || '',
};

export function ensureDirs() {
  for (const p of [path.dirname(env.DB_PATH), env.UPLOAD_DIR]) {
    const abs = path.isAbsolute(p) ? p : path.join(root, p);
    fs.mkdirSync(abs, { recursive: true });
  }
}
ensureDirs();
export const ROOT = root;
export function resolvePath(p) {
  return path.isAbsolute(p) ? p : path.join(root, p);
}

// Pasta gravavel do usuario (a mesma do banco). Relatorios e logs vao para ca,
// nunca para ROOT, que pode ser somente leitura quando instalado (Program Files, AppImage).
export function dataDir() {
  return path.dirname(resolvePath(env.DB_PATH));
}
