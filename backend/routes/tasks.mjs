import express from 'express';
import * as TS from '../services/taskService.mjs';

const router = express.Router();

router.get('/agents', (req, res) => res.json(TS.listAgents()));

router.post('/plan', async (req, res) => {
  const { goal, provider, model } = req.body || {};
  if (!goal) return res.status(400).json({ error: 'goal obrigatorio' });
  try {
    const steps = await TS.createPlan(goal, { provider, model });
    res.json({ goal, steps });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', async (req, res) => {
  const { goal, conversationId, provider, model, autoRun, agentId, plan } = req.body || {};
  if (!goal || typeof goal !== 'string') return res.status(400).json({ error: 'goal obrigatorio' });
  try {
    // Agente escolhido na tela "Agentes": antes o campo era ignorado e o agente era sempre automatico.
    let steps;
    if (plan !== undefined) {
      if (!Array.isArray(plan) || plan.length < 1 || plan.length > 8) return res.status(400).json({ error: 'plan deve conter de 1 a 8 etapas' });
      const agentIds = new Set(TS.listAgents().map(agent => agent.id));
      steps = [];
      for (let index = 0; index < plan.length; index++) {
        const step = plan[index];
        if (!step || typeof step !== 'object' || Array.isArray(step) ||
            typeof step.title !== 'string' || !step.title.trim() || step.title.length > 200 ||
            typeof step.agent !== 'string' || !agentIds.has(step.agent) ||
            !Array.isArray(step.dependsOn) ||
            step.dependsOn.some(dependency => !Number.isInteger(dependency) || dependency < 0 || dependency >= index)) {
          return res.status(400).json({ error: `etapa ${index + 1} invalida` });
        }
        steps.push({ title: step.title.trim(), agent: step.agent, dependsOn: step.dependsOn });
      }
    } else if (agentId) {
      if (!TS.listAgents().some(a => a.id === agentId)) return res.status(400).json({ error: 'agentId desconhecido' });
      steps = [{ title: goal.slice(0, 200), agent: agentId, dependsOn: [] }];
    } else steps = await TS.createPlan(goal, { provider, model });
    const task = TS.createTask({ goal, conversationId, plan: steps });
    if (autoRun === true) {
      // fire and forget
      TS.runTask({ taskId: task.id, context: { provider, model } }).catch(e => console.error('[task]', e.message));
    }
    res.status(201).json(task);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/', (req, res) => res.json(TS.listTasks(Number(req.query.limit) || 50)));

router.get('/:id', (req, res) => {
  const t = TS.getTask(req.params.id);
  if (!t) return res.status(404).json({ error: 'Tarefa nao encontrada' });
  res.json(t);
});

router.post('/:id/run', async (req, res) => {
  const { provider, model } = req.body || {};
  try {
    const t = await TS.runTask({ taskId: req.params.id, context: { provider, model } });
    res.json(t);
  } catch (e) { res.status(e.status || (/nao encontrada/i.test(e.message) ? 404 : 500)).json({ error: e.message }); }
});

router.post('/:id/cancel', (req, res) => {
  const t = TS.cancelTask(req.params.id);
  if (!t) return res.status(404).json({ error: 'Tarefa nao encontrada' });
  res.json(t);
});

export default router;
