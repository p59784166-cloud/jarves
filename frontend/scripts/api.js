const API = '';
function networkHint(error) {
  if (error?.name === 'AbortError') return 'Solicitação cancelada.';
  if (error && (error.name === 'TypeError' || /failed to fetch|networkerror|load failed|fetch failed/i.test(error.message || ''))) {
    if (typeof location !== 'undefined' && location.protocol === 'file:') return 'O JARVES foi aberto como arquivo. Inicie o servidor pelo inicializador da pasta PC e abra http://localhost:3000.';
    const origin = typeof location !== 'undefined' ? location.origin : 'o endereço do servidor';
    return `Não foi possível acessar ${origin}. Verifique se o JARVES está iniciado, se o endereço está correto e se firewall/rede permitem a conexão.`;
  }
  return error?.message || 'Falha inesperada na comunicação com o servidor.';
}
async function request(path, opts = {}) {
  let res;
  try {
    res = await fetch(API + path, {
      ...opts,
      headers: { ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) },
      body: opts.body !== undefined ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)) : undefined,
      cache: opts.cache || 'no-store',
    });
  } catch (error) { throw new Error(networkHint(error), { cause: error }); }
  let raw;
  try { raw = await res.text(); } catch (error) { throw new Error(networkHint(error), { cause: error }); }
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!res.ok) {
    const message = data && typeof data === 'object' && data.error ? data.error : `Erro HTTP ${res.status}${res.statusText ? `: ${res.statusText}` : ''}`;
    throw new Error(message);
  }
  return data;
}
const idPath = (id) => encodeURIComponent(String(id));
const api = {
  health: () => request('/api/health'),
  listConversations: (search) => request('/api/conversations' + (search ? '?search=' + encodeURIComponent(search) : '')),
  createConversation: (payload) => request('/api/conversations', { method: 'POST', body: payload || {} }),
  unifyConversations: () => request('/api/conversations/unify', { method: 'POST', body: {} }),
  getConversation: (id) => request('/api/conversations/' + idPath(id)),
  updateConversation: (id, payload) => request('/api/conversations/' + idPath(id), { method: 'PATCH', body: payload }),
  deleteConversation: (id) => request('/api/conversations/' + idPath(id), { method: 'DELETE' }),
  sendMessage: (payload) => request('/api/chat', { method: 'POST', body: payload }),
  cancel: (requestId) => request('/api/chat/cancel', { method: 'POST', body: { requestId } }),
  listModels: (provider) => request('/api/models' + (provider ? '?provider=' + encodeURIComponent(provider) : '')),
  checkModel: (provider, model) => request('/api/models/check?provider=' + encodeURIComponent(provider) + '&model=' + encodeURIComponent(model)),
  pullModel: (model) => request('/api/models/pull', { method: 'POST', body: { model } }),
  getSettings: () => request('/api/settings'),
  setSetting: (key, value) => request('/api/settings/' + encodeURIComponent(key), { method: 'PUT', body: { value } }),
  deleteSetting: (key) => request('/api/settings/' + encodeURIComponent(key), { method: 'DELETE' }),
  listMemory: (q) => request('/api/memory?limit=200' + (q ? '&q=' + encodeURIComponent(q) : '')),
  searchMemory: (q) => request('/api/memory/search?q=' + encodeURIComponent(q)),
  createMemory: (payload) => request('/api/memory', { method: 'POST', body: payload }),
  updateMemory: (id, payload) => request('/api/memory/' + idPath(id), { method: 'PATCH', body: payload }),
  deleteMemory: (id) => request('/api/memory/' + idPath(id), { method: 'DELETE' }),
  listFiles: () => request('/api/files'),
  uploadFile: (payload) => request('/api/files/upload', { method: 'POST', body: payload }),
  downloadFile: (url) => request('/api/files/download', { method: 'POST', body: { url } }),
  fileDownloadUrl: (id) => '/api/files/' + idPath(id) + '/download',
  deleteFile: (id) => request('/api/files/' + idPath(id), { method: 'DELETE' }),
  fileContent: (id) => request('/api/files/' + idPath(id) + '/content'),
  analyzeCode: (code) => request('/api/files/analyze', { method: 'POST', body: { code } }),
  listAgents: () => request('/api/tasks/agents'),
  plan: (goal, context = {}) => request('/api/tasks/plan', { method: 'POST', body: { goal, ...context } }),
  createTask: (payload) => request('/api/tasks', { method: 'POST', body: payload }),
  listTasks: () => request('/api/tasks'),
  getTask: (id) => request('/api/tasks/' + idPath(id)),
  runTask: (id, context = {}) => request('/api/tasks/' + idPath(id) + '/run', { method: 'POST', body: context }),
  cancelTask: (id) => request('/api/tasks/' + idPath(id) + '/cancel', { method: 'POST', body: {} }),
  research: (query, limit = 8) => request('/api/research', { method: 'POST', body: { query, limit } }),
  runDiagnostics: (opts) => request('/api/diagnostics/run', { method: 'POST', body: opts || {} }),
  lastDiagnostics: () => request('/api/diagnostics/last'),
  imageGeneratorStatus: () => request('/api/images/status'),
  generateImage: (payload) => request('/api/images/generate', { method: 'POST', body: payload }),
  exportDiagnostics: (format) => '/api/diagnostics/export?format=' + encodeURIComponent(format),
};
window.api = api;
window.jarvesNetworkHint = networkHint;
