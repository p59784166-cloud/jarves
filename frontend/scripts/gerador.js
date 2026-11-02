/* Gerador local: cria SVG, malhas 3D e projetos HTML; Ollama opcional roda no dispositivo/servidor do usuário. */
(function () {
  'use strict';
  const main = document.querySelector('.main');
  if (!main) return;

  const sec = document.createElement('section');
  sec.className = 'view content-view'; sec.id = 'view-gerador'; sec.hidden = true;
  sec.innerHTML = '<div class="page-heading"><p class="eyebrow">GERAÇÃO LOCAL · SEM API PAGA</p><h1>Gerador</h1><p>Crie ilustrações 2D, modelos 3D e experiências HTML para visualizar, baixar ou salvar.</p></div>' +
    '<div class="panel"><label>O que criar?<textarea id="genPrompt" placeholder="Ex.: paisagem ao pôr do sol · modelo 3D de um cilindro azul · experiência interativa de um planeta"></textarea></label>' +
    '<div class="row"><select id="genType" aria-label="Tipo"><option value="auto">Automático</option><option value="imagem">Imagem 2D (SVG offline ou PNG por IA)</option><option value="modelo-3d">Modelo 3D (OBJ/GLB)</option><option value="experiencia">Projeto 2D + 3D + HTML interativo</option><option value="jogo">Jogo HTML</option><option value="site">Site (HTML+CSS+JS)</option><option value="app-todo">App: tarefas</option><option value="app-calc">App: calculadora</option></select>' +
    '<select id="genEngine" aria-label="Motor"><option value="base">Motor local (offline)</option><option value="ia">Ollama local (gratuito, se configurado)</option><option value="image-ai">IA de imagem local (Automatic1111/Forge)</option></select>' +
    '<button class="primary-btn" id="genGo" type="button">✦ Gerar</button></div><p class="muted-copy">O motor offline gera formas e ilustrações simples sem internet. Ollama é opcional, sem cobrança de API; exige instalar e executar um modelo local, com consumo de hardware e energia.</p></div>' +
    '<details class="panel"><summary>Configurar IA de imagem local (grátis)</summary><p class="muted-copy">Conecte um Automatic1111 ou Forge instalado no computador que executa o servidor JARVES. Inicie o motor com a API habilitada (por exemplo, <code>--api</code>). A geração não usa API paga, mas exige baixar um modelo e recursos de hardware; o desempenho depende do seu equipamento.</p><label for="genImageUrl">Endereço local do motor</label><input id="genImageUrl" type="url" inputmode="url" placeholder="http://127.0.0.1:7860"><div class="row"><button class="secondary-btn" id="genImageSave" type="button">Salvar endereço</button><button class="secondary-btn" id="genImageTest" type="button">Testar conexão</button><span id="genImageConfigStatus" class="status" role="status" aria-live="polite"></span></div></details>' +
    '<div class="panel" id="genOut" hidden><h3>Plano</h3><ol id="genPlan"></ol><h3>Arquivos</h3><div class="list" id="genFiles"></div>' +
    '<div class="row"><button class="secondary-btn" id="genZip" type="button">⇩ Baixar tudo (.zip)</button><button class="secondary-btn" id="genSave" type="button">▤ Salvar em Arquivos</button><button class="secondary-btn" id="genPng" type="button" hidden>🖼 Baixar PNG</button></div>' +
    '<div class="status" id="genStatus"></div><h3>Pré-visualização</h3><img id="genImagePreview" alt="Imagem gerada pelo modelo local" hidden style="max-width:100%;height:auto;border-radius:12px"><iframe id="genFrame" title="Pré-visualização" sandbox="allow-scripts" style="width:100%;height:480px;border:1px solid var(--line);border-radius:12px;background:#fff"></iframe></div>';
  main.appendChild(sec);

  const $ = (id) => document.getElementById(id);
  let current = null;
  const status = (t) => { $('genStatus').textContent = t; };
  const fileBytes = (file) => {
    if (file?.encoding === 'base64') {
      const binary = atob(file.content);
      return Uint8Array.from(binary, ch => ch.charCodeAt(0));
    }
    return file?.content instanceof Uint8Array ? file.content : new TextEncoder().encode(String(file?.content ?? ''));
  };

  // ---- download (navegador e app Android) ----
  function download(name, blob) {
    if (window.AndroidBridge && window.AndroidBridge.saveFile) {
      const fr = new FileReader();
      fr.onload = () => { window.AndroidBridge.saveFile(name, String(fr.result).split(',')[1], blob.type || 'application/octet-stream'); status('Salvo em Downloads: ' + name); };
      fr.readAsDataURL(blob); return;
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  // ---- ZIP (sem compressao) ----
  const CRC = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u8) => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function makeZip(files) {
    const enc = new TextEncoder(), parts = [], central = []; let offset = 0;
    const u16 = (v) => [v & 255, (v >> 8) & 255], u32 = (v) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
    for (const f of files) {
      const name = enc.encode(f.name), data = fileBytes(f), crc = crc32(data);
      const local = new Uint8Array([0x50, 0x4b, 3, 4, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)]);
      parts.push(local, name, data);
      central.push(new Uint8Array([0x50, 0x4b, 1, 2, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), name);
      offset += local.length + name.length + data.length;
    }
    const csize = central.reduce((n, p) => n + p.length, 0);
    const end = new Uint8Array([0x50, 0x4b, 5, 6, 0, 0, 0, 0, ...u16(files.length), ...u16(files.length), ...u32(csize), ...u32(offset), 0, 0]);
    return new Blob([...parts, ...central, end], { type: 'application/zip' });
  }

  // ---- previa: embute css/js do site ----
  function previewDoc(files) {
    const main = files.find(f => /\.html?$/.test(f.name)); if (!main) return '';
    let h = main.content;
    h = h.replace(/<link[^>]+href="([^"]+\.css)"[^>]*>/g, (m, n) => { const f = files.find(x => x.name === n); return f ? '<style>' + f.content + '</style>' : m; });
    h = h.replace(/<script[^>]+src="([^"]+\.js)"[^>]*><\/script>/g, (m, n) => { const f = files.find(x => x.name === n); return f ? '<script>' + f.content.replace(/<\/script/gi, '<\\/script') + '<\/script>' : m; });
    return h;
  }

  function show(res, note = '') {
    current = res;
    $('genOut').hidden = false;
    const ol = $('genPlan'); ol.innerHTML = ''; res.plan.forEach(p => { const li = document.createElement('li'); li.textContent = p; ol.appendChild(li); });
    const list = $('genFiles'); list.innerHTML = '';
    res.files.forEach(f => {
      const row = document.createElement('div'); row.className = 'row';
      const lbl = document.createElement('span'); lbl.style.flex = '1'; lbl.textContent = f.name + ' · ' + Math.max(1, Math.round(fileBytes(f).length / 1024)) + ' KB';
      const b = document.createElement('button'); b.className = 'secondary-btn'; b.type = 'button'; b.textContent = '⇩ Baixar';
      b.addEventListener('click', () => download(f.name, new Blob([fileBytes(f)], { type: f.mime || 'text/plain' })));
      row.append(lbl, b); list.appendChild(row);
    });
    const svg = res.files.find(f => f.name.endsWith('.svg'));
    const png = res.files.find(f => f.mime === 'image/png' && f.encoding === 'base64');
    $('genPng').hidden = !svg;
    $('genImagePreview').hidden = !png;
    $('genImagePreview').removeAttribute('src');
    $('genFrame').hidden = Boolean(png);
    if (png) $('genImagePreview').src = 'data:image/png;base64,' + png.content;
    else $('genFrame').srcdoc = svg ? '<body style="margin:0;background:#000"><div style="max-width:100%">' + svg.content.replace('width="1024" height="768"', 'style="width:100%;height:auto"') + '</div></body>' : previewDoc(res.files);
    status(note || ('Pronto. ' + res.files.length + ' arquivo(s).'));
  }

  async function loadImageGeneratorSettings() {
    try {
      const result = await window.api.getSettings();
      $('genImageUrl').value = result.settings?.image_gen_url || result.defaults?.image_gen_url || 'http://127.0.0.1:7860';
    } catch (error) {
      $('genImageConfigStatus').textContent = 'Não foi possível carregar: ' + error.message;
    }
  }
  loadImageGeneratorSettings();
  $('genImageSave').addEventListener('click', async () => {
    const status = $('genImageConfigStatus');
    try {
      await window.api.setSetting('image_gen_url', $('genImageUrl').value.trim());
      status.textContent = 'Endereço local salvo.';
    } catch (error) { status.textContent = 'Erro ao salvar: ' + error.message; }
  });
  $('genImageTest').addEventListener('click', async () => {
    const status = $('genImageConfigStatus');
    status.textContent = 'Verificando motor...';
    try {
      await window.api.setSetting('image_gen_url', $('genImageUrl').value.trim());
      const result = await window.api.imageGeneratorStatus();
      status.textContent = 'Conectado: ' + result.provider + (result.model ? ' · ' + result.model : '');
    } catch (error) { status.textContent = 'Não conectado: ' + error.message; }
  });

  // ---- IA do Ollama: pede o HTML e extrai o codigo ----
  async function viaIA(prompt, type) {
    const meshRequest = type === 'modelo-3d';
    const sys = meshRequest
      ? 'Responda SOMENTE JSON válido, sem markdown: {"shape":"cube|sphere|cylinder|cone","color":"#RRGGBB","segments":16}. Escolha uma forma simples adequada ao pedido. segments deve estar entre 8 e 32.'
      : 'Você gera um projeto web autocontido. Responda SOMENTE com um bloco ```html contendo UM arquivo HTML completo, responsivo e sem dependências externas, scripts remotos ou chamadas de rede. Sem explicações.';
    const task = meshRequest
      ? 'Escolha parâmetros para um modelo 3D simples baseado nesta descrição: '
      : 'Crie uma experiência HTML interativa sobre: ';
    const r = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: task + prompt, systemPrompt: sys, stream: false, provider: 'ollama' }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'falha na IA');
    if (meshRequest) {
      const raw = String(j.content || '').replace(/^```(?:json)?\s*|\s*```$/gi, '').trim();
      let spec;
      try { spec = JSON.parse(raw); } catch { throw new Error('Ollama não devolveu parâmetros 3D válidos.'); }
      if (!spec || !['cube', 'sphere', 'cylinder', 'cone'].includes(spec.shape)) throw new Error('Ollama escolheu uma forma 3D não suportada.');
      return {
        shape: spec.shape,
        color: /^#[\da-f]{6}$/i.test(spec.color || '') ? spec.color : '#7c8cff',
        segments: Number.isInteger(spec.segments) ? Math.min(32, Math.max(8, spec.segments)) : 16,
        model: j.model || 'Ollama local',
      };
    }
    const m = String(j.content || '').match(/```(?:html)?\s*([\s\S]*?)```/i);
    const code = (m ? m[1] : j.content || '').trim();
    if (!/<html|<!doctype|<svg|<canvas|<body/i.test(code)) throw new Error('A IA não devolveu HTML utilizável (modelo ' + (j.model || '?') + ').');
    return { type: type || 'auto', model: j.model || 'Ollama local', plan: ['Gerar HTML com o modelo local ' + (j.model || ''), 'Conferir e abrir a pré-visualização isolada'], files: [{ name: 'experiencia.html', mime: 'text/html', content: code }] };
  }

  $('genGo').addEventListener('click', async () => {
    const prompt = $('genPrompt').value.trim();
    if (!prompt) { status('Escreva o que quer criar.'); $('genOut').hidden = false; return; }
    const selectedType = $('genType').value;
    const type = selectedType === 'auto' ? window.JARVES_BASE.generate(prompt, 'auto').type : selectedType;
    $('genGo').disabled = true; status('Gerando...'); $('genOut').hidden = false;
    try {
      let res, note = '';
      if ($('genEngine').value === 'image-ai') {
        if (type !== 'imagem') throw new Error('A IA de imagem gera imagens rasterizadas. Escolha “Modelo 2D (SVG)” ou “Automático” no tipo.');
        const generated = await window.api.generateImage({ prompt, width: 768, height: 768, steps: 20 });
        res = {
          type: 'imagem',
          model: generated.model || 'Automatic1111/Forge local',
          plan: ['Enviar o pedido ao motor de imagem local configurado', 'Gerar PNG 768×768 no modelo instalado', 'Revisar a imagem antes de compartilhar'],
          files: [{ name: 'imagem-gerada.png', mime: 'image/png', encoding: 'base64', content: generated.image }],
        };
        note = 'Imagem gerada no modelo local ' + (generated.model || 'Automatic1111/Forge') + '. A inferência ocorreu no computador/servidor configurado; nenhum serviço pago foi chamado.';
      } else if ($('genEngine').value === 'ia' && type === 'modelo-3d') {
        try {
          const spec = await viaIA(prompt, type);
          res = window.JARVES_BASE.generate(prompt, type, spec);
          note = 'Forma 3D selecionada pelo Ollama local (' + spec.model + '); malha e arquivos gerados offline.';
        } catch (e) {
          note = 'Ollama local indisponível (' + e.message + '). Usando o gerador 3D offline.';
          res = window.JARVES_BASE.generate(prompt, type);
        }
      } else if ($('genEngine').value === 'ia' && ['site', 'jogo', 'experiencia'].includes(type)) {
        try {
          const generated = await viaIA(prompt, type);
          if (type === 'experiencia') {
            const base = window.JARVES_BASE.generate(prompt, type);
            res = { ...base, plan: [...base.plan, 'Adicionar a experiência HTML produzida pelo Ollama local'], files: [base.files[0], ...generated.files, ...base.files.slice(1)] };
          } else res = generated;
          note = 'Conteúdo gerado pelo Ollama local (' + generated.model + '); revise os arquivos antes de compartilhar.';
        } catch (e) {
          note = 'Ollama local indisponível (' + e.message + '). Usando o gerador offline.';
          res = window.JARVES_BASE.generate(prompt, type);
        }
      } else {
        res = window.JARVES_BASE.generate(prompt, type);
        if ($('genEngine').value === 'ia' && type === 'imagem') note = 'SVG criado pelo gerador offline; nenhum serviço de IA foi chamado.';
      }
      show(res, note);
    } catch (e) { status('Erro: ' + e.message); }
    finally { $('genGo').disabled = false; }
  });
  $('genZip').addEventListener('click', () => { if (current) download('jarves-projeto.zip', makeZip(current.files)); });
  $('genSave').addEventListener('click', async () => {
    if (!current) return;
    let n = 0;
    let failed = 0;
    for (const f of current.files) {
      const bytes = fileBytes(f); let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      try { const r = await fetch('/api/files/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: f.name, mime: f.mime || 'text/plain', data: btoa(bin) }) }); if (r.ok) n++; else failed++; } catch { failed++; }
    }
    status(n + ' arquivo(s) salvo(s) em "Arquivos e código"' + (failed ? `; ${failed} falha(s) ao salvar.` : '.'));
  });
  $('genPng').addEventListener('click', () => {
    const svg = current && current.files.find(f => f.name.endsWith('.svg')); if (!svg) return;
    const img = new Image();
    img.onload = () => { const c = document.createElement('canvas'); c.width = 1024; c.height = 768; c.getContext('2d').drawImage(img, 0, 0); c.toBlob(b => download('imagem.png', b), 'image/png'); };
    img.onerror = () => status('Não foi possível converter para PNG; baixe o .svg.');
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg.content);
  });
})();
