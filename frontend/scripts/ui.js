function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function renderMarkdown(text) {
  // Blocos de codigo sao guardados antes: antes "**kwargs" ou `x` DENTRO do codigo virava negrito/inline.
  const blocks = [];
  let s = escapeHtml(text);
  s = s.replace(/```[\w+-]*\n?([\s\S]*?)```/g, (_, code) => { blocks.push(`<pre class="code-block"><code>${code.replace(/\n$/, '')}</code></pre>`); return `\u0000B${blocks.length - 1}\u0000`; });
  const inline = [];
  s = s.replace(/`([^`\n]+)`/g, (_, code) => { inline.push(`<code class="inline-code">${code}</code>`); return `\u0000I${inline.length - 1}\u0000`; });
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\u0000I(\d+)\u0000/g, (_, i) => inline[i]).replace(/\u0000B(\d+)\u0000/g, (_, i) => blocks[i]);
  return s;
}
function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.textContent = msg;
  el.style.cssText = 'position:fixed;bottom:20px;right:20px;background:var(--panel);border:1px solid var(--border);padding:10px 14px;border-radius:8px;z-index:100;box-shadow:var(--shadow);';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}
window.escapeHtml = escapeHtml;
window.renderMarkdown = renderMarkdown;
window.toast = toast;
