import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarves-task-'));
process.env.DB_PATH = path.join(tmp, 't.db'); process.env.NODE_ENV = 'test'; process.env.AI_PROVIDER = 'mock';
const TS = await import('../../backend/services/taskService.mjs');
const { getDb } = await import('../../backend/services/db.mjs');

test('cada etapa recebe o objetivo e o resultado das etapas anteriores', async () => {
  const goal = 'criar API de tarefas';
  const task = TS.createTask({ goal, plan: [{ title: 'Projetar', agent: 'planner' }, { title: 'Implementar', agent: 'programmer' }] });
  const done = await TS.runTask({ taskId: task.id });
  assert.equal(done.status, 'done');
  // o provider mock ecoa o INICIO da ultima mensagem: o objetivo precisa estar nele
  assert.match(done.steps[0].output, /Objetivo geral: criar API/);
  assert.match(done.steps[1].output, /Objetivo geral/);
});

test('cancelar interrompe a execucao e o status final continua "cancelled"', async () => {
  const task = TS.createTask({ goal: 'longa', plan: Array.from({ length: 5 }, (_, i) => ({ title: 'E' + i, agent: 'general' })) });
  const run = TS.runTask({ taskId: task.id });
  await new Promise(r => setTimeout(r, 120));
  TS.cancelTask(task.id);
  const final = await run;
  assert.equal(final.status, 'cancelled');           // antes era sobrescrito por 'done'
  assert.ok(final.steps.some(s => s.status === 'cancelled'));
  assert.ok(final.steps.filter(s => s.status === 'done').length < 5);
});

test('executar a mesma tarefa duas vezes ao mesmo tempo e recusado (409)', async () => {
  const task = TS.createTask({ goal: 'x', plan: [{ title: 'A', agent: 'general' }, { title: 'B', agent: 'general' }] });
  const first = TS.runTask({ taskId: task.id });
  await assert.rejects(TS.runTask({ taskId: task.id }), err => err.status === 409);
  await first;
});

test('cancelar tarefa inexistente retorna null', () => assert.equal(TS.cancelTask('nao-existe'), null));
