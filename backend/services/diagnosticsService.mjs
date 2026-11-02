import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { env, ROOT, dataDir, resolvePath } from '../config/env.mjs';
import { getDb } from './db.mjs';
import { listAvailableModels } from './aiService.mjs';
import { analyzeCodeSnippet } from './fileService.mjs';
import { addResolvedBug, listResolvedBugs } from './resolvedBugs.mjs';

// Gravado na pasta do usuario (junto do banco), nao em ROOT (somente leitura quando instalado).
const reportFile = () => path.join(dataDir(), 'last-diagnostic.json');

// Executa a suite sem bloquear o servidor (spawnSync travava TODAS as requisicoes por ate 3 min).
function runNodeTests() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--test', '--test-reporter=tap'], {
      cwd: ROOT, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const collect = d => { out += d.toString(); if (out.length > 400000) out = out.slice(-200000); };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    const timer = setTimeout(() => child.kill(), 180000);
    child.on('error', e => { clearTimeout(timer); resolve({ out: String(e.message), error: e }); });
    child.on('close', () => { clearTimeout(timer); resolve({ out }); });
  });
}

function mkErr(partial) {
  return {
    id: partial.id || `ERR-${Math.random().toString(36).slice(2,8).toUpperCase()}`,
    name: partial.name || 'Erro desconhecido',
    file: partial.file || '-',
    line: partial.line ?? null,
    category: partial.category || 'GERAL',
    severity: partial.severity || 'MEDIO',
    description: partial.description || '',
    probableCause: partial.probableCause || '',
    recommendedFix: partial.recommendedFix || '',
    status: partial.status || 'PENDENTE',
    testResult: partial.testResult || 'NAO_TESTADO',
    timestamp: new Date().toISOString(),
  };
}

export async function runDiagnostics({ runTests = false } = {}) {
  const errors = [];
  const checks = [];

  // 1. Database
  try {
    getDb().prepare('SELECT 1').get();
    checks.push({ name: 'database', ok: true });
  } catch (e) {
    checks.push({ name: 'database', ok: false, error: e.message });
    errors.push(mkErr({
      name: 'Falha no banco de dados',
      file: 'backend/services/db.mjs',
      category: 'BANCO_DE_DADOS',
      severity: 'CRITICO',
      description: 'Nao foi possivel acessar o SQLite.',
      probableCause: e.message,
      recommendedFix: 'Verifique permissoes e caminho DB_PATH.',
    }));
  }

  // 2. Provider / models
  try {
    const r = await listAvailableModels();
    if (r.error) throw new Error(r.error);
    if (!r.models || r.models.length === 0) throw new Error('Nenhum modelo disponivel');
    checks.push({ name: 'provider', ok: true, models: r.models.length });
  } catch (e) {
    checks.push({ name: 'provider', ok: false, error: e.message });
    errors.push(mkErr({
      name: 'Provedor de IA indisponivel',
      file: 'backend/services/aiService.mjs',
      category: 'IA',
      severity: 'ALTO',
      description: 'Nao foi possivel listar modelos do provedor configurado.',
      probableCause: e.message,
      recommendedFix: 'Configure Ollama ou outro provedor nas Configuracoes e teste a conexao.',
    }));
  }

  // 3. Upload dir
  try {
    const uploads = resolvePath(env.UPLOAD_DIR);
    fs.mkdirSync(uploads, { recursive: true });
    fs.accessSync(uploads, fs.constants.W_OK);
    checks.push({ name: 'uploads', ok: true });
  } catch (e) {
    checks.push({ name: 'uploads', ok: false, error: e.message });
    errors.push(mkErr({
      name: 'Diretorio de uploads inacessivel',
      file: 'backend/services/fileService.mjs',
      category: 'ARQUIVOS',
      severity: 'MEDIO',
      description: 'Nao foi possivel escrever no diretorio de uploads.',
      probableCause: e.message,
      recommendedFix: 'Verifique UPLOAD_DIR e permissoes.',
    }));
  }

  // 4. Tests (opcional: demorado; so existe no codigo-fonte, nao no aplicativo instalado)
  let testSummary = { pass: 0, fail: 0, raw: '' };
  if (!runTests) {
    checks.push({ name: 'tests', ok: true, skipped: true, note: 'Nao executados (envie runTests=true para rodar a suite).' });
  } else if (!fs.existsSync(path.join(ROOT, 'tests'))) {
    checks.push({ name: 'tests', ok: true, skipped: true, note: 'Pasta tests ausente nesta instalacao.' });
  } else {
    const res = await runNodeTests();
    const out = res.out || '';
    testSummary.raw = out.slice(-4000);
    const pm = out.match(/#\s*pass\s+(\d+)/);
    const fm = out.match(/#\s*fail\s+(\d+)/);
    testSummary.pass = pm ? Number(pm[1]) : 0;
    testSummary.fail = fm ? Number(fm[1]) : 0;
    if (res.error || (!pm && !fm)) {
      checks.push({ name: 'tests', ok: false, error: res.error?.message || 'Saida dos testes nao reconhecida' });
      errors.push(mkErr({ name: 'Falha ao executar testes', category: 'TESTES', severity: 'ALTO', description: 'Nao foi possivel executar a suite de testes.', probableCause: res.error?.message || out.slice(-300), recommendedFix: 'Execute npm test manualmente.' }));
    } else {
      for (const l of out.split('\n')) {
        const m = l.match(/^\s*not ok \d+ - (.+)/);
        if (m) errors.push(mkErr({ name: 'Teste reprovado: ' + m[1], file: 'tests/', category: 'TESTES', severity: 'ALTO', description: 'Um teste automatizado falhou.', probableCause: 'Verifique saida dos testes.', recommendedFix: 'Corrija o codigo e reexecute npm test.', testResult: 'FALHOU' }));
      }
      checks.push({ name: 'tests', ok: testSummary.fail === 0, pass: testSummary.pass, fail: testSummary.fail });
    }
  }

  // 5. Scan source for common issues (pendencias/eval)
  const scanDirs = ['backend', 'ai', 'frontend/scripts'];
  for (const d of scanDirs) {
    const full = path.join(ROOT, d);
    if (!fs.existsSync(full)) continue;
    walk(full, (file) => {
      if (file.endsWith('fileService.mjs') || file.endsWith('diagnosticsService.mjs')) return;
      try {
        const content = fs.readFileSync(file, 'utf8');
        const issues = analyzeCodeSnippet(content);
        if (issues.issues.length) {
          for (const iss of issues.issues) {
            errors.push(mkErr({
              name: iss.message,
              file: path.relative(ROOT, file),
              category: 'CODIGO',
              severity: iss.severity === 'high' ? 'ALTO' : (iss.severity === 'medium' ? 'MEDIO' : 'BAIXO'),
              description: `Problema detectado em ${path.relative(ROOT, file)}.`,
              probableCause: iss.message,
              recommendedFix: 'Revise o codigo indicado.',
              status: 'PENDENTE',
            }));
          }
        }
      } catch {}
    });
  }

  const report = {
    id: 'DIAG-' + Date.now(),
    timestamp: new Date().toISOString(),
    summary: {
      totalErrors: errors.length,
      critical: errors.filter(e => e.severity === 'CRITICO').length,
      high: errors.filter(e => e.severity === 'ALTO').length,
      medium: errors.filter(e => e.severity === 'MEDIO').length,
      low: errors.filter(e => e.severity === 'BAIXO').length,
      info: errors.filter(e => e.severity === 'INFORMATIVO').length,
      testsPass: testSummary.pass,
      testsFail: testSummary.fail,
    },
    checks,
    errors,
    resolvedBugs: listResolvedBugs(),
    recommendations: buildRecommendations(errors),
  };

  try {
    fs.mkdirSync(path.dirname(reportFile()), { recursive: true });
    fs.writeFileSync(reportFile(), JSON.stringify(report, null, 2));
  } catch {}
  return report;
}

export function getLastReport() {
  try {
    return JSON.parse(fs.readFileSync(reportFile(), 'utf8'));
  } catch {
    return null;
  }
}

export function exportReport(format = 'json') {
  const report = getLastReport();
  if (!report) return null;
  if (format === 'json') return JSON.stringify(report, null, 2);
  if (format === 'txt') {
    const lines = [];
    lines.push('JARVES AI - RELATORIO DE DIAGNOSTICO');
    lines.push('ID: ' + report.id);
    lines.push('Data: ' + report.timestamp);
    lines.push('');
    lines.push('RESUMO');
    lines.push('Total de erros: ' + report.summary.totalErrors);
    lines.push('Criticos: ' + report.summary.critical);
    lines.push('Altos: ' + report.summary.high);
    lines.push('Medios: ' + report.summary.medium);
    lines.push('Baixos: ' + report.summary.low);
    lines.push('Testes aprovados: ' + report.summary.testsPass);
    lines.push('Testes reprovados: ' + report.summary.testsFail);
    lines.push('');
    lines.push('ERROS');
    for (const e of report.errors) {
      lines.push(`[${e.severity}] ${e.id} - ${e.name}`);
      lines.push(`  Arquivo: ${e.file}${e.line ? ':' + e.line : ''}`);
      lines.push(`  Categoria: ${e.category}`);
      lines.push(`  Descricao: ${e.description}`);
      lines.push(`  Causa provavel: ${e.probableCause}`);
      lines.push(`  Solucao: ${e.recommendedFix}`);
      lines.push(`  Status: ${e.status}`);
      lines.push('');
    }
    lines.push('RECOMENDACOES');
    for (const r of report.recommendations) lines.push('- ' + r);
    return lines.join('\n');
  }
  if (format === 'html') {
    const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    let html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>JARVES AI Diagnostico</title><style>body{font-family:sans-serif;padding:20px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px} .critico{color:#b00020;font-weight:bold}</style></head><body>';
    html += '<h1>JARVES AI - Diagnostico</h1>';
    html += '<p>ID: ' + esc(report.id) + ' | Data: ' + esc(report.timestamp) + '</p>';
    html += '<h2>Resumo</h2><ul>';
    html += '<li>Total de erros: ' + report.summary.totalErrors + '</li>';
    html += '<li>Criticos: ' + report.summary.critical + '</li>';
    html += '<li>Altos: ' + report.summary.high + '</li>';
    html += '<li>Medios: ' + report.summary.medium + '</li>';
    html += '<li>Baixos: ' + report.summary.low + '</li>';
    html += '<li>Testes aprovados: ' + report.summary.testsPass + '</li>';
    html += '<li>Testes reprovados: ' + report.summary.testsFail + '</li>';
    html += '</ul>';
    html += '<h2>Erros</h2><table><tr><th>ID</th><th>Severidade</th><th>Nome</th><th>Arquivo</th><th>Categoria</th><th>Descricao</th><th>Causa</th><th>Solucao</th><th>Status</th></tr>';
    for (const e of report.errors) {
      html += '<tr><td>' + esc(e.id) + '</td><td class="' + e.severity.toLowerCase() + '">' + esc(e.severity) + '</td><td>' + esc(e.name) + '</td><td>' + esc(e.file) + '</td><td>' + esc(e.category) + '</td><td>' + esc(e.description) + '</td><td>' + esc(e.probableCause) + '</td><td>' + esc(e.recommendedFix) + '</td><td>' + esc(e.status) + '</td></tr>';
    }
    html += '</table>';
    html += '<h2>Bugs resolvidos</h2><ul>';
    for (const b of (report.resolvedBugs || [])) html += '<li>' + esc(b.id) + ' - ' + esc(b.file) + ' (' + esc(b.testResult) + ')</li>';
    if (!(report.resolvedBugs || []).length) html += '<li>Nenhum</li>';
    html += '</ul>';
    html += '<h2>Recomendacoes</h2><ul>';
    for (const r of report.recommendations) html += '<li>' + esc(r) + '</li>';
    html += '</ul></body></html>';
    return html;
  }
  return null;
}

// Somente arquivos DENTRO do programa; nunca dados do usuario, segredos, .git ou dependencias.
// Antes aceitava qualquer caminho absoluto/".." (sobrescrever qualquer arquivo do computador).
const BLOCKED_TOP = new Set(['data', 'node_modules', '.git', 'dist']);
function resolveInsideRoot(filePath) {
  if (typeof filePath !== 'string' || !filePath || filePath.includes('\0')) throw new Error('Caminho invalido');
  const full = path.resolve(ROOT, filePath);
  const rel = path.relative(ROOT, full);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Caminho fora da pasta do programa');
  const top = rel.split(path.sep)[0];
  if (BLOCKED_TOP.has(top) || /^\.env/.test(path.basename(full)) || path.basename(full).startsWith('.jarves-secret')) throw new Error('Arquivo protegido');
  return full;
}

export function createBackup(filePath) {
  const full = resolveInsideRoot(filePath);
  if (!fs.existsSync(full)) return null;
  const backup = full + '.bak.' + Date.now();
  fs.copyFileSync(full, backup);
  return backup;
}

export async function applyFix({ filePath, find, replace, runTests = false }) {
  const full = resolveInsideRoot(filePath);
  if (!fs.existsSync(full)) throw new Error('Arquivo nao encontrado');
  if (typeof find !== 'string' || typeof replace !== 'string') throw new Error('find e replace devem ser texto');
  const original = fs.readFileSync(full, 'utf8');
  if (!original.includes(find)) throw new Error('Trecho nao encontrado');
  const backup = createBackup(filePath);
  // Funcao como substituto: com string, "$&" / "$1" no codigo corrigido eram interpretados e corrompiam o arquivo.
  fs.writeFileSync(full, original.replace(find, () => replace));
  let testResult = 'NAO_EXECUTADO';
  if (runTests && fs.existsSync(path.join(ROOT, 'tests'))) {
    const res = await runNodeTests();
    const fm = (res.out || '').match(/#\s*fail\s+(\d+)/);
    testResult = res.error ? 'ERRO' : ((fm && Number(fm[1]) > 0) ? 'FALHOU' : 'APROVADO');
  }
  addResolvedBug({ file: filePath, find, testResult, backup });
  return { ok: true, backup, testResult };
}

function buildRecommendations(errors) {
  const recs = [];
  if (errors.some(e => e.category === 'IA')) recs.push('Configure um provedor de IA (Ollama) e verifique modelos instalados.');
  if (errors.some(e => e.category === 'TESTES')) recs.push('Corrija os testes reprovados antes de publicar.');
  if (errors.some(e => e.category === 'CODIGO')) recs.push('Revise os problemas de codigo detectados.');
  if (!errors.length) recs.push('Nenhum problema detectado. Sistema saudavel.');
  return recs;
}

function walk(dir, cb) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.git', 'data', 'dist'].includes(entry.name)) continue;
      walk(full, cb);
    } else if (/\.(mjs|js|html)$/.test(entry.name)) {
      cb(full);
    }
  }
}
