import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from '../config/env.mjs';

const file = () => path.join(dataDir(), 'resolved-bugs.json');

export function listResolvedBugs() {
  try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return []; }
}

export function addResolvedBug(entry) {
  const list = listResolvedBugs();
  list.unshift({ id: 'FIX-' + Date.now(), timestamp: new Date().toISOString(), ...entry });
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(list.slice(0, 100), null, 2));
  return list[0];
}
