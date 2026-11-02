import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skip = new Set(['node_modules', '.git', 'dist', 'build', 'android']);
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && skip.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(?:js|mjs|cjs)$/.test(entry.name)) files.push(full);
  }
}
for (const dir of ['backend', 'ai', 'database', 'desktop', 'executor', 'frontend/scripts', 'scripts']) {
  const full = path.join(root, dir);
  if (fs.existsSync(full)) walk(full);
}
let failed = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    failed++;
    process.stderr.write(`\\n[ERRO] ${path.relative(root, file)}\\n${result.stderr || result.stdout}`);
  }
}
console.log(`JARVES AI source check: ${files.length - failed}/${files.length} arquivos JavaScript validos.`);
if (failed) process.exitCode = 1;
