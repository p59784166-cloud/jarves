/* JARVES AI - HTML Mega Test Suite
 * Testes locais e de integracao sem alterar dados do usuario.
 */
(() => {
  'use strict';
  const run = async () => {
    const output = document.getElementById('htmlTestResults');
    const summary = document.getElementById('htmlTestSummary');
    const progress = document.getElementById('htmlTestProgress');
    const button = document.getElementById('btnRunHtmlTests');
    if (!output || !summary || !button) return;

    const checks = [];
    const add = (name, ok, detail = '') => checks.push({ name, ok: Boolean(ok), detail: String(detail || '') });
    const byId = id => Boolean(document.getElementById(id));

    button.disabled = true;
    button.textContent = 'Executando testes...';
    output.replaceChildren();
    summary.textContent = 'Verificando interface e serviços...';
    if (progress) progress.textContent = '0%';

    // 1. Elementos essenciais da interface
    const required = ['sidebar','chatArea','input','btnSend','convList','view-settings'];
    required.forEach(id => add(`Elemento #${id}`, byId(id), byId(id) ? 'Encontrado' : 'Elemento ausente'));

    // 2. Recursos carregados
    const scripts = [...document.scripts].filter(s => s.src);
    const styles = [...document.styleSheets];
    add('Scripts principais', scripts.some(s => s.src.includes('/scripts/app.js')), `${scripts.length} scripts externos encontrados`);
    add('Folha de estilos', styles.length > 0, `${styles.length} folha(s) de estilo`);
    add('Tema visual', ['dark','light'].includes(document.documentElement.dataset.theme), `Tema: ${document.documentElement.dataset.theme || 'não definido'}`);

    // 3. APIs JavaScript
    ['state','api','toast','renderMarkdown'].forEach(key => add(`Módulo ${key}`, typeof window[key] !== 'undefined', typeof window[key]));
    add('Navegador Fetch', typeof window.fetch === 'function', 'API Fetch disponível');
    add('Armazenamento local', (() => { try { const k='jarves-test-'+Date.now(); localStorage.setItem(k,'1'); localStorage.removeItem(k); return true; } catch { return false; } })(), 'Teste de gravação temporária');

    // 4. Arquivos públicos
    try {
      const response = await fetch('/manifest.json', { cache: 'no-store' });
      add('Manifest PWA', response.ok, `HTTP ${response.status}`);
      if (response.ok) {
        const manifest = await response.json();
        add('Manifest válido', Boolean(manifest.name || manifest.short_name), manifest.name || manifest.short_name || 'Nome ausente');
      }
    } catch (error) { add('Manifest PWA', false, error.message); }

    // 5. Backend
    try {
      const response = await fetch('/api/health', { cache: 'no-store' });
      add('API de saúde', response.ok, `HTTP ${response.status}`);
      if (response.ok) {
        const data = await response.json();
        add('Resposta JSON da API', Boolean(data && typeof data === 'object'), 'Resposta recebida');
      }
    } catch (error) { add('API de saúde', false, error.message || 'Servidor indisponível'); }

    // 6. Responsividade
    add('Viewport configurado', Boolean(document.querySelector('meta[name="viewport"]')), 'Meta viewport');
    add('Layout executável', document.documentElement.clientWidth > 0, `${document.documentElement.clientWidth}px de largura`);
    add('Modo seguro de navegação', window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.protocol === 'file:', window.isSecureContext ? 'Contexto seguro' : 'Contexto local ou não seguro');

    const passed = checks.filter(x => x.ok).length;
    const failed = checks.length - passed;
    checks.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = `html-test-row ${item.ok ? 'pass' : 'fail'}`;
      const icon = document.createElement('span');
      icon.className = 'html-test-icon';
      icon.textContent = item.ok ? '✓' : '!';
      const body = document.createElement('div');
      body.className = 'html-test-body';
      const title = document.createElement('strong');
      title.textContent = item.name;
      const detail = document.createElement('small');
      detail.textContent = item.detail;
      body.append(title, detail);
      row.append(icon, body);
      output.appendChild(row);
      if (progress) progress.textContent = `${Math.round(((index + 1) / checks.length) * 100)}%`;
    });

    summary.textContent = `${passed}/${checks.length} testes aprovados · ${failed} falha(s). ${failed ? 'Revise os itens marcados.' : 'Verificações concluídas.'}`;
    summary.dataset.status = failed ? 'warning' : 'success';
    button.disabled = false;
    button.textContent = 'Executar testes novamente';
    const report = { app: 'JARVES AI', suite: 'HTML Mega Update', date: new Date().toISOString(), passed, failed, checks };
    window.jarvesHtmlTestReport = report;
    const exportButton = document.getElementById('btnExportHtmlTests');
    if (exportButton) exportButton.onclick = () => {
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'jarves-html-test-report.json'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
  };

  document.addEventListener('DOMContentLoaded', () => {
    const button = document.getElementById('btnRunHtmlTests');
    if (button) button.addEventListener('click', run);
  });
})();
