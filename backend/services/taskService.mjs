import { getDb } from './db.mjs';
import { newId, nowIso } from './id.mjs';
import { selectAgentsForTask } from '../../ai/agents/registry.mjs';
import { createAgents } from '../../ai/agents/registry.mjs';
import { chatOnce } from './aiService.mjs';

const agents = createAgents();
const agentMap = Object.fromEntries(agents.map(a => [a.id, a]));

export function listAgents() {
  return agents.map(a => ({ id: a.id, name: a.name, description: a.description, available: a.available, allowedTools: a.allowedTools }));
}

export async function createPlan(goal, context = {}) {
  // Ask planner agent/model to produce JSON plan; fallback heuristic.
  const prompt = `Divida o objetivo em etapas executaveis. Responda APENAS em JSON valido no formato:
{"steps":[{"title":"...","agent":"id do agente","dependsOn":[]}]}. Objetivo: ${goal}`;
  let steps = [];
  try {
    const res = await chatOnce({ provider: context.provider, model: context.model, messages: [{ role: 'user', content: prompt }], options: { temperature: 0.3, maxTokens: 1024 } });
    const txt = res.content;
    const match = txt.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed.steps)) steps = parsed.steps;
    }
  } catch {}
  if (!steps.length) {
    const ids = selectAgentsForTask(goal);
    steps = ids.map((id, i) => ({ title: `Etapa ${i + 1}: ${agentMap[id]?.name || id}`, agent: id, dependsOn: i > 0 ? [i - 1] : [] }));
  }
  // normalize
  steps = steps.slice(0, 8).map((s, i) => ({
    title: String(s.title || `Etapa ${i + 1}`),
    agent: agentMap[s.agent] ? s.agent : (selectAgentsForTask(goal)[0] || 'general'),
    dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn : [],
  }));
  return steps;
}

export function createTask({ goal, conversationId = null, plan = null }) {
  const db = getDb();
  const id = newId();
  const now = nowIso();
  db.prepare('INSERT INTO tasks (id,conversation_id,goal,status,plan,result,error,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, conversationId, goal, 'pending', JSON.stringify(plan || []), null, null, now, now);
  if (plan) {
    plan.forEach((s, i) => {
      db.prepare('INSERT INTO task_steps (id,task_id,idx,title,status,agent_id) VALUES (?,?,?,?,?,?)')
        .run(newId(), id, i, s.title, 'pending', s.agent);
    });
  }
  return getTask(id);
}

export function getTask(id) {
  const db = getDb();
  const t = db.prepare('SELECT * FROM tasks WHERE id=?').get(id);
  if (!t) return null;
  const steps = db.prepare('SELECT * FROM task_steps WHERE task_id=? ORDER BY idx ASC').all(t.id);
  return { ...t, plan: safeJson(t.plan), steps: steps.map(s => ({ ...s, input: safeJson(s.input) })) };
}

export function listTasks(limit = 50) {
  const db = getDb();
  return db.prepare('SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?').all(limit).map(t => ({ ...t, plan: safeJson(t.plan) }));
}

const running = new Map(); // taskId -> AbortController (permite cancelar de verdade)

function clip(text, n) { const t = String(text || ''); return t.length > n ? t.slice(0, n) + ' [...]' : t; }

export async function runTask({ taskId, context = {}, onProgress = null, signal = null }) {
  const task = getTask(taskId);
  if (!task) throw new Error('Tarefa nao encontrada');
  if (running.has(taskId)) { const e = new Error('Tarefa ja esta em execucao'); e.status = 409; throw e; }
  const db = getDb();
  const controller = new AbortController();
  running.set(taskId, controller);
  if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });
  db.prepare('UPDATE tasks SET status=?,updated_at=? WHERE id=?').run('running', nowIso(), taskId);
  const results = [];
  const isCancelled = () => controller.signal.aborted || db.prepare('SELECT status FROM tasks WHERE id=?').get(taskId)?.status === 'cancelled';

  try {
    const MAX_STEPS = 10;
    let executed = 0;
    for (const step of task.steps) {
      if (isCancelled() || executed >= MAX_STEPS) break;
      updateStep(step.id, 'running', null, null);
      onProgress?.({ taskId, stepId: step.id, status: 'running' });
      const agent = agentMap[step.agent_id] || agentMap.general;
      // Antes cada etapa recebia so o titulo ("Etapa 2: Programador"), sem o objetivo nem o que as
      // etapas anteriores produziram - o modelo respondia no vazio.
      const previous = results.filter(r => !r.error).map(r => `### ${r.step}\n${clip(r.output, 1500)}`).join('\n\n');
      const prompt = `Objetivo geral: ${task.goal}\n\nEtapa ${executed + 1} de ${task.steps.length}: ${step.title}` +
        (previous ? `\n\nResultados das etapas anteriores:\n${previous}` : '') +
        '\n\nExecute apenas esta etapa e responda de forma objetiva.';
      try {
        const r = await agent.run({ task: prompt, context, history: [], signal: controller.signal });
        updateStep(step.id, 'done', r.content?.slice(0, 4000), null);
        results.push({ step: step.title, agent: agent.id, output: r.content });
        onProgress?.({ taskId, stepId: step.id, status: 'done', output: r.content });
      } catch (e) {
        const cancelled = isCancelled();
        updateStep(step.id, cancelled ? 'cancelled' : 'failed', null, cancelled ? 'Cancelado' : e.message);
        if (!cancelled) results.push({ step: step.title, agent: agent.id, error: e.message });
        onProgress?.({ taskId, stepId: step.id, status: cancelled ? 'cancelled' : 'failed', error: e.message });
      }
      executed++;
    }
    const cancelled = isCancelled();
    const summary = results.map(r => `## ${r.step}\n${r.error ? 'ERRO: ' + r.error : (r.output || '')}`).join('\n\n');
    // Cancelamento nao pode ser sobrescrito por 'done' (era o que acontecia).
    const finalStatus = cancelled ? 'cancelled' : (results.every(r => !r.error) ? 'done' : 'partial');
    db.prepare('UPDATE tasks SET status=?,result=?,updated_at=? WHERE id=?').run(finalStatus, summary, nowIso(), taskId);
    if (cancelled) db.prepare('UPDATE task_steps SET status=? WHERE task_id=? AND status IN (?,?)').run('cancelled', taskId, 'pending', 'running');
  } finally { running.delete(taskId); }
  return getTask(taskId);
}

export function cancelTask(taskId) {
  const db = getDb();
  if (!db.prepare('SELECT 1 FROM tasks WHERE id=?').get(taskId)) return null;
  db.prepare('UPDATE tasks SET status=?,updated_at=? WHERE id=?').run('cancelled', nowIso(), taskId);
  db.prepare('UPDATE task_steps SET status=? WHERE task_id=? AND status IN (?,?,?)').run('cancelled', taskId, 'pending', 'running', 'awaiting');
  running.get(taskId)?.abort(); // interrompe a chamada em andamento ao modelo
  return getTask(taskId);
}

function updateStep(id, status, output, error) {
  const db = getDb();
  const now = nowIso();
  if (status === 'running') db.prepare('UPDATE task_steps SET status=?,started_at=? WHERE id=?').run(status, now, id);
  else db.prepare('UPDATE task_steps SET status=?,output=?,error=?,finished_at=? WHERE id=?').run(status, output, error, now, id);
}

function safeJson(s) { try { return s ? JSON.parse(s) : null; } catch { return s; } }
