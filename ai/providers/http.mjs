// Timeout por inatividade + cancelamento do usuario, distinguindo os dois casos.
export function withTimeout(userSignal, ms) {
  const controller = new AbortController();
  let timedOut = false;
  let timer = null;
  const arm = () => { clearTimeout(timer); timer = setTimeout(() => { timedOut = true; controller.abort(); }, ms); };
  const onAbort = () => controller.abort();
  if (userSignal) {
    if (userSignal.aborted) controller.abort();
    else userSignal.addEventListener('abort', onAbort, { once: true });
  }
  arm();
  return {
    signal: controller.signal,
    touch: arm,
    timedOut: () => timedOut,
    cleanup() { clearTimeout(timer); userSignal?.removeEventListener('abort', onAbort); },
  };
}

export function timeoutError(service, ms) {
  const e = new Error(`Tempo limite de ${Math.round(ms / 1000)} s excedido ao aguardar ${service}. Aumente o tempo limite em Configuracoes ou use um modelo menor.`);
  e.code = 'TIMEOUT';
  return e;
}

export function trimUrl(u) { return String(u || '').replace(/\/+$/, ''); }
