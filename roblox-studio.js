document.addEventListener('DOMContentLoaded', () => {
  const $ = id => document.getElementById(id);
  const tokenInput = $('robloxBridgeToken');
  const addressInput = $('robloxBridgeAddress');
  const pairButton = $('btnRobloxPair');
  const copyButton = $('btnCopyRobloxToken');
  const queueButton = $('btnQueueRobloxScript');
  if (!tokenInput || !addressInput || !pairButton || !copyButton || !queueButton) return;

  if (window.location.protocol === 'file:') {
    const pluginDownload = document.querySelector('#view-roblox-studio a[download]');
    if (pluginDownload) {
      pluginDownload.href = 'https://raw.githubusercontent.com/p59784166-cloud/jarves/main/frontend/roblox-plugin/JARVESStudioPlugin.lua';
    }
    pairButton.disabled = true;
    queueButton.disabled = true;
    $('robloxBridgeStatus').textContent = 'A ponte Roblox requer o servidor JARVES em execução; o arquivo standalone não inclui o backend.';
    return;
  }

  let token = '';
  let connected = false;
  addressInput.value = window.location.origin;

  function report(message, isError = false) {
    $('robloxBridgeStatus').textContent = message;
    $('robloxBridgeStatus').style.color = isError ? 'var(--danger)' : '';
  }

  async function refresh() {
    addressInput.value = window.location.origin;
    if (!token) return;
    try {
      const state = await window.api.robloxStatus(token);
      connected = true;
      queueButton.disabled = false;
      report(`Token válido · ${state.queued} script(s) na fila. Conecte o plugin no Studio para recebê-los.`);
    } catch (error) {
      connected = false;
      queueButton.disabled = true;
      report(error.message, true);
    }
  }

  pairButton.addEventListener('click', async () => {
    pairButton.disabled = true;
    report('Gerando token local...');
    try {
      const result = await window.api.robloxPair();
      token = result.token;
      connected = true;
      tokenInput.value = token;
      copyButton.disabled = false;
      queueButton.disabled = false;
      report('Token gerado. Ele será invalidado quando o servidor JARVES reiniciar.');
      window.toast?.('Copie o token e cole-o no plugin do Roblox Studio.', 'success');
    } catch (error) {
      token = '';
      connected = false;
      tokenInput.value = '';
      copyButton.disabled = true;
      queueButton.disabled = true;
      report(error.message, true);
    } finally {
      pairButton.disabled = false;
    }
  });

  copyButton.addEventListener('click', async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      window.toast?.('Token copiado.', 'success');
    } catch (error) {
      report(`Não foi possível copiar o token: ${error.message}`, true);
    }
  });

  queueButton.addEventListener('click', async () => {
    if (!connected || !token) {
      report('Gere um token e conecte o plugin antes de enviar scripts.', true);
      return;
    }
    queueButton.disabled = true;
    $('robloxQueueStatus').textContent = 'Enviando script para a fila local...';
    try {
      const result = await window.api.robloxQueue(token, {
        name: $('robloxScriptName').value,
        target: $('robloxScriptTarget').value,
        source: $('robloxScriptSource').value,
      });
      $('robloxQueueStatus').textContent = `Script enfileirado (${result.queued} na fila). Aprove a inserção no Roblox Studio.`;
      await refresh();
    } catch (error) {
      $('robloxQueueStatus').textContent = error.message;
      $('robloxQueueStatus').style.color = 'var(--danger)';
    } finally {
      queueButton.disabled = !connected;
    }
  });

  window.jarvesRobloxStudio = { refresh };
});
