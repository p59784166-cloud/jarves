import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { env, resolvePath } from '../config/env.mjs';
import { getDb } from './db.mjs';
import { newId, nowIso } from './id.mjs';

const UPLOAD_ROOT = resolvePath(env.UPLOAD_DIR);

function safeJoin(base, rel) {
  const resolved = path.resolve(base, rel || '');
  if (!resolved.startsWith(path.resolve(base) + path.sep) && resolved !== path.resolve(base)) {
    throw new Error('Caminho invalido');
  }
  return resolved;
}

export function ensureUploadRoot() { fs.mkdirSync(UPLOAD_ROOT, { recursive: true }); return UPLOAD_ROOT; }

export function validateFileMeta(name, size, mime) {
  if (!name || typeof name !== 'string') throw new Error('Nome de arquivo invalido');
  if (name === '.' || name === '..' || /[\\/\0]/.test(name) || name.length > 255) throw new Error('Nome de arquivo invalido');
  if (size > env.MAX_UPLOAD_BYTES) throw new Error(`Arquivo excede limite de ${env.MAX_UPLOAD_BYTES} bytes`);
  return true;
}

export function listFiles(subdir = '') {
  ensureUploadRoot();
  const base = safeJoin(UPLOAD_ROOT, subdir);
  const entries = fs.readdirSync(base, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    const full = path.join(base, e.name);
    try {
      const stat = fs.statSync(full);
      out.push({ name: e.name, isDir: e.isDirectory(), size: stat.size, mtime: stat.mtime.toISOString(), path: path.relative(UPLOAD_ROOT, full) });
    } catch { /* link quebrado ou arquivo removido durante a listagem */ }
  }
  return out;
}

export function saveUploadedFile({ originalName, buffer, mime }) {
  validateFileMeta(originalName, buffer.length, mime);
  ensureUploadRoot();
  const id = newId();
  const ext = path.extname(originalName).replace(/[^.a-zA-Z0-9]/g, '').slice(0, 16);
  const storedName = id + ext;
  const full = path.join(UPLOAD_ROOT, storedName);
  fs.writeFileSync(full, buffer);
  const db = getDb();
  try {
    db.prepare('INSERT INTO files (id,name,path,size,mime,kind,created_at,metadata) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, originalName, storedName, buffer.length, mime || null, classify(mime, originalName), nowIso(), JSON.stringify({ originalName }));
  } catch (e) { try { fs.unlinkSync(full); } catch {} throw e; } // nao deixa arquivo orfao no disco
  return getFile(id);
}

export async function saveUploadedFileStream({ originalName, stream, mime }) {
  validateFileMeta(originalName, 0, mime);
  ensureUploadRoot();
  const id = newId();
  const ext = path.extname(originalName).replace(/[^.a-zA-Z0-9]/g, '').slice(0, 16);
  const storedName = id + ext;
  const full = path.join(UPLOAD_ROOT, storedName);
  let size = 0;
  const limiter = new Transform({
    transform(chunk, encoding, callback) {
      size += chunk.length;
      if (size > env.MAX_UPLOAD_BYTES) {
        callback(Object.assign(new Error(`Arquivo excede limite de ${env.MAX_UPLOAD_BYTES} bytes`), { status: 413 }));
        return;
      }
      callback(null, chunk);
    },
  });
  try {
    await pipeline(stream, limiter, fs.createWriteStream(full, { flags: 'wx' }));
    const db = getDb();
    db.prepare('INSERT INTO files (id,name,path,size,mime,kind,created_at,metadata) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, originalName, storedName, size, mime || null, classify(mime, originalName), nowIso(), JSON.stringify({ originalName }));
  } catch (error) {
    try { fs.unlinkSync(full); } catch (cleanupError) {
      if (cleanupError.code !== 'ENOENT') console.error('[FILES] Não foi possível remover download incompleto:', cleanupError.message);
    }
    throw error;
  }
  return getFile(id);
}

export function getFile(id) {
  const db = getDb();
  const r = db.prepare('SELECT * FROM files WHERE id=?').get(id);
  if (!r) return null;
  return { ...r, metadata: safeParse(r.metadata) };
}

export function listFileRecords(limit = 200) {
  const db = getDb();
  return db.prepare('SELECT * FROM files ORDER BY created_at DESC LIMIT ?').all(limit).map(r => ({ ...r, metadata: safeParse(r.metadata) }));
}

export function deleteFile(id) {
  const db = getDb();
  const r = db.prepare('SELECT * FROM files WHERE id=?').get(id);
  if (!r) return false;
  try { fs.unlinkSync(safeJoin(UPLOAD_ROOT, r.path)); } catch {}
  db.prepare('DELETE FROM files WHERE id=?').run(id);
  return true;
}

export function readFileContent(id, maxBytes = 200000) {
  const r = getFile(id);
  if (!r) throw new Error('Arquivo nao encontrado');
  const full = path.join(UPLOAD_ROOT, r.path);
  if (!fs.existsSync(full)) throw new Error('Arquivo fisico ausente');
  const stat = fs.statSync(full);
  if (stat.size > maxBytes) throw new Error('Arquivo muito grande para leitura');
  const buf = fs.readFileSync(full);
  if (buf.includes(0)) throw new Error('Arquivo binario: nao e possivel exibir como texto');
  return { id: r.id, name: r.name, size: r.size, mime: r.mime, kind: r.kind, content: buf.toString('utf8') };
}

// Bytes originais do arquivo (para pre-visualizacao/download sem corromper binarios).
export function readFileBuffer(id) {
  const r = getFile(id);
  if (!r) throw new Error('Arquivo nao encontrado');
  const full = safeJoin(UPLOAD_ROOT, r.path);
  if (!fs.existsSync(full)) throw new Error('Arquivo fisico ausente');
  return { record: r, buffer: fs.readFileSync(full) };
}

export function createFileReadStream(id) {
  const record = getFile(id);
  if (!record) throw new Error('Arquivo nao encontrado');
  const full = safeJoin(UPLOAD_ROOT, record.path);
  if (!fs.existsSync(full)) throw new Error('Arquivo fisico ausente');
  const size = fs.statSync(full).size;
  return { record, size, stream: fs.createReadStream(full) };
}

export function analyzeCodeSnippet(code, language = 'auto') {
  const issues = [];
  if (typeof code !== 'string') return { issues: [{ severity: 'high', message: 'O conteúdo precisa ser texto', line: null, column: null }], summary: 'Entrada inválida', lineCount: 0, syntaxCheck: 'not-checked' };
  if (!code) return { issues, summary: 'Codigo vazio', lineCount: 0, syntaxCheck: 'not-checked' };
  const lines = code.split(/\n/);
  const addIssue = (severity, message, index = -1) => {
    const before = index < 0 ? '' : code.slice(0, index);
    const line = index < 0 ? null : before.split('\n').length;
    const column = index < 0 ? null : index - before.lastIndexOf('\n');
    issues.push({ severity, message, line, column });
  };
  const normalizedLanguage = String(language || 'auto').toLowerCase();
  const isJson = ['json', 'application/json'].includes(normalizedLanguage)
    || (normalizedLanguage === 'auto' && /^[\s]*[\[{]/.test(code) && /["'][^"'{}\n]+["']\s*:/.test(code));
  const isJavaScript = ['js', 'javascript', 'mjs', 'cjs', 'node'].includes(normalizedLanguage)
    || (normalizedLanguage === 'auto' && /\b(?:const|let|var|function|class|import|export|await)\b|=>|\beval\s*\(/.test(code));
  let syntaxCheck = 'not-checked';

  if (isJson) {
    try {
      JSON.parse(code);
      syntaxCheck = 'passed';
    } catch (error) {
      syntaxCheck = 'failed';
      const positionMatch = error.message.match(/position\s+(\d+)/i);
      const context = error.message.match(/^Unexpected token '[^']*', "([\s\S]*)" is not valid JSON$/)?.[1];
      const token = error.message.match(/^Unexpected token '([^']*)'/)?.[1];
      const contextIndex = context ? code.indexOf(context) : -1;
      const index = positionMatch
        ? Number(positionMatch[1])
        : contextIndex >= 0 && token
          ? contextIndex + context.indexOf(token)
          : /Unexpected end/i.test(error.message)
            ? code.length
            : token
              ? code.lastIndexOf(token)
              : -1;
      addIssue('high', `Erro de sintaxe JSON: ${error.message.split(' at position ')[0]}`, index);
    }
  } else if (isJavaScript) {
    syntaxCheck = 'passed';
    const isModule = /^\s*(?:import\s|export\s|await\b)/m.test(code);
    if (!isModule) {
      try {
        new vm.Script(code, { filename: 'codigo-analisado.js' });
      } catch (error) {
        syntaxCheck = 'failed';
        const match = error.stack?.match(/codigo-analisado\.js:(\d+)/);
        const line = match ? Number(match[1]) : null;
        const sourceLines = error.stack?.split('\n') || [];
        const marker = match ? sourceLines.findIndex(item => item.includes(`codigo-analisado.js:${match[1]}`)) : -1;
        const column = marker >= 0 ? (sourceLines[marker + 2]?.indexOf('^') ?? -1) + 1 : null;
        issues.push({ severity: 'high', message: `Erro de sintaxe JavaScript: ${error.message.split('\n')[0]}`, line, column: column > 0 ? column : null });
      }
    } else {
      const checked = spawnSync(process.execPath, ['--check', '--input-type=module'], {
        input: code,
        encoding: 'utf8',
        timeout: 5000,
        maxBuffer: 1024 * 1024,
      });
      if (checked.error) {
        syntaxCheck = 'unavailable';
        addIssue('medium', `Não foi possível verificar a sintaxe do módulo: ${checked.error.message}`);
      } else if (checked.status !== 0) {
        syntaxCheck = 'failed';
        const output = checked.stderr || checked.stdout || '';
        const line = Number(output.match(/\[stdin\]:(\d+)/)?.[1]) || null;
        const rows = output.split('\n');
        const marker = line ? rows.findIndex(item => item.startsWith(`[stdin]:${line}`)) : -1;
        const column = marker >= 0 ? (rows[marker + 2]?.indexOf('^') ?? -1) + 1 : null;
        const message = output.match(/SyntaxError: ([^\n]+)/)?.[1] || 'Código inválido';
        issues.push({ severity: 'high', message: `Erro de sintaxe JavaScript: ${message}`, line, column: column > 0 ? column : null });
      }
    }
  }

  const addPatternIssue = (pattern, severity, message) => {
    const match = pattern.exec(code);
    if (match) addIssue(severity, message, match.index);
  };
  addPatternIssue(/\beval\s*\(/, 'high', 'Uso de eval detectado');
  addPatternIssue(/\bpassword\s*=\s*['"][^'"]+['"]/i, 'high', 'Possivel segredo hardcoded');
  addPatternIssue(/\b(?:TODO|FIXME)\b/, 'low', 'TODO/FIXME encontrado');
  if (lines.length > 1000) addIssue('medium', 'Arquivo muito longo, considere modularizar');
  const checkedLanguage = isJson ? 'json' : isJavaScript ? 'javascript' : normalizedLanguage;
  const syntaxNote = syntaxCheck === 'not-checked' ? ' (sintaxe nao validada para esta linguagem)' : '';
  return {
    issues,
    lineCount: lines.length,
    language: checkedLanguage,
    syntaxCheck,
    summary: issues.length ? `${issues.length} problema(s) potencial(is)` : `Nenhum problema obvio detectado${syntaxNote}`,
  };
}

function classify(mime, name) {
  const n = (name || '').toLowerCase();
  if (mime?.startsWith('image/')) return 'image';
  if (n.endsWith('.js') || n.endsWith('.mjs') || n.endsWith('.ts')) return 'code-js';
  if (n.endsWith('.py')) return 'code-py';
  if (n.endsWith('.json')) return 'json';
  if (n.endsWith('.md') || n.endsWith('.txt')) return 'text';
  if (n.endsWith('.html') || n.endsWith('.css')) return 'web';
  return 'other';
}

function safeParse(s) { try { return s ? JSON.parse(s) : null; } catch { return null; } }
export { safeJoin, UPLOAD_ROOT };
