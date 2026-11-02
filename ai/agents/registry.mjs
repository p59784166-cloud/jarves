import { GenericAgent } from './genericAgent.mjs';

const PROMPTS = {
  general: 'Voce e o JARVES AI, um assistente geral em portugues brasileiro. Seja claro, preciso e util. Admita limitacoes.',
  programmer: 'Voce e um agente programador especialista. Analise, escreva, explique e revise codigo. Use blocos de codigo. Identifique bugs e sugira testes.',
  researcher: 'Voce e um agente pesquisador. Sintetize informacoes, cite fontes quando disponiveis, distinga fatos de hipoteses.',
  studies: 'Voce e um agente de estudos. Explique de forma didatica, crie exercicios e planos de estudo.',
  planner: 'Voce e um agente planejador. Divida objetivos em etapas, dependencias e prioridades. Produza planos estruturados.',
  filemanager: 'Voce e um agente gerenciador de arquivos. Analise arquivos fornecidos, organize e explique conteudo. Nao execute arquivos.',
  gamedev: 'Voce e um agente desenvolvedor de jogos. Planeje estruturas de projeto, mecanicas e codigo de jogos.',
  reviewer: 'Voce e um revisor de qualidade. Analise erros, sugira testes, identifique regressoes e melhorias.',
  productivity: 'Voce e um agente de produtividade. Organize tarefas, listas e documentos.',
  coordinator: 'Voce e o coordenador. Escolha agentes apropriados, distribua subtarefas e consolide resultados. Seja conciso.',
};

const SPECS = [
  { id: 'general', name: 'Assistente Geral', description: 'Conversacao, explicacoes e tarefas comuns.', prompt: 'general', tools: ['chat'] },
  { id: 'programmer', name: 'Programador', description: 'Analise, escrita e revisao de codigo.', prompt: 'programmer', tools: ['code_analyze', 'run_tests'] },
  { id: 'researcher', name: 'Pesquisador', description: 'Pesquisa de informacoes e fontes.', prompt: 'researcher', tools: ['research'] },
  { id: 'studies', name: 'Estudos', description: 'Explicacoes, exercicios e planos de estudo.', prompt: 'studies', tools: [] },
  { id: 'planner', name: 'Planejador', description: 'Divisao de objetivos em etapas.', prompt: 'planner', tools: [] },
  { id: 'filemanager', name: 'Gerenciador de Arquivos', description: 'Listagem, leitura e analise de arquivos.', prompt: 'filemanager', tools: ['file_list', 'file_read'] },
  { id: 'gamedev', name: 'Desenvolvedor de Jogos', description: 'Planejamento e codigo de jogos.', prompt: 'gamedev', tools: [] },
  { id: 'reviewer', name: 'Revisor de Qualidade', description: 'Analise de erros e testes.', prompt: 'reviewer', tools: ['code_analyze', 'run_tests'] },
  { id: 'productivity', name: 'Produtividade', description: 'Tarefas, listas e documentos.', prompt: 'productivity', tools: [] },
  { id: 'coordinator', name: 'Coordenador', description: 'Escolha e consolidacao de agentes.', prompt: 'coordinator', tools: [] },
];

export function createAgents() {
  return SPECS.map(s => new GenericAgent({
    id: s.id,
    name: s.name,
    description: s.description,
    systemPrompt: PROMPTS[s.prompt],
    allowedTools: s.tools,
    maxSteps: 5,
  }));
}

export function getAgentSpecs() { return SPECS.map(s => ({ ...s, systemPrompt: PROMPTS[s.prompt] })); }

export function selectAgentsForTask(goal) {
  const g = (goal || '').toLowerCase();
  const chosen = new Set(['general']);
  if (/c[oó]digo|program|bug|fun[cç][aã]o|api|javascript|python|node/.test(g)) chosen.add('programmer');
  if (/pesquis|buscar|fonte|informa[cç][aã]o|not[ií]cia/.test(g)) chosen.add('researcher');
  if (/estud|aprender|exerc[ií]cio|aula|prova/.test(g)) chosen.add('studies');
  if (/plan|etapa|projeto|cronograma|roadmap/.test(g)) chosen.add('planner');
  if (/arquivo|pasta|diret[oó]rio|upload/.test(g)) chosen.add('filemanager');
  if (/jogo|game|unity|godot/.test(g)) chosen.add('gamedev');
  if (/revis|qualidade|teste|erro/.test(g)) chosen.add('reviewer');
  if (/tarefa|lista|organiz|documento|relat[oó]rio/.test(g)) chosen.add('productivity');
  // coordinator always for multi
  if (chosen.size > 2) chosen.add('coordinator');
  return [...chosen];
}
