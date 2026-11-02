const state = {
  currentConversationId: null,
  conversations: [],
  messages: [],
  models: [],
  selectedModel: null,
  selectedProvider: null,
  theme: (() => { try { return localStorage.getItem('theme') || 'dark'; } catch { return 'dark'; } })(),
  view: 'chat',
  generating: false,
  currentRequestId: null,
  agents: [],
  draft: '',
};
function loadDraft() {
  try { return localStorage.getItem('jerver_draft') || ''; } catch { return ''; }
}
function saveDraft(v) {
  try { localStorage.setItem('jerver_draft', v); } catch {}
}
function saveTheme(v) { try { localStorage.setItem('theme', v); } catch {} }
window.saveTheme = saveTheme;
window.state = state;
window.loadDraft = loadDraft;
window.saveDraft = saveDraft;
