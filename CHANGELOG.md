# Changelog

## 2.4.2
- Geração de projetos de código estruturados, com validação de manifesto, nomes, extensões, conteúdo e limites antes da exportação.
- Análise estática de sintaxe JavaScript e JSON sem executar o código enviado; linguagens sem verificador compatível são identificadas claramente.
- Preferências de resposta e instruções personalizadas aplicadas ao chat, com comandos rápidos documentados na interface.
- Atualizados os metadados de versão para os próximos builds Android, Windows e Linux.

## 2.4.1
- Menu lateral simplificado; as ferramentas agora são acessadas pelo painel Atalhos no Chat.
- Geração de imagens PNG integrada à conversa pelo Automatic1111/Forge local, com prévia e download em 512, 768 ou 1024 px.
- Som curto opcional ao terminar uma resposta, com preferência salva localmente.
- Atualizados os ícones do aplicativo Android, desktop e site com a arte oficial JARVES.
- Melhorados os controles acessíveis do menu móvel e adicionada a arte completa ao site BAXAI.

## 2.4.0
- APK Android passa a oferecer chat com inferência real no próprio aparelho via LiteRT-LM, sem depender de um PC.
- Adicionado download retomável e validação SHA-256 do modelo Gemma 4 E2B Apache-2.0; o download de 2,59 GB é feito após confirmação da pessoa.
- Histórico do chat local fica no armazenamento privado do app; modos Chat, Código, Resumo, Tradução e Plano usam o modelo local.
- Mantida a conexão opcional ao servidor JARVES no PC para acesso à interface web e às ferramentas completas.
- Atualizado o site de downloads com requisitos de armazenamento/RAM, privacidade e modo offline.
- Android atualizado para versionCode 240; LiteRT-LM 0.19.0 e Kotlin 2.4.0.

## 2.3.8
- Nova ponte local com Roblox Studio usando plugin Luau, token temporario e fila limitada; insercoes exigem aprovacao manual dentro do Studio.
- Documentada a limitação oficial do Roblox Studio no Linux; uso via Wine permanece não oficial.
- Corrigida a validação de loopback para aceitar conexões IPv4 e IPv6 locais na ponte Roblox.
- SQLite sem FTS5 agora inicializa normalmente e usa a busca de memória por LIKE como fallback.
- Builds e artefatos APK, EXE e AppImage passam a usar a versão do `package.json`; Android atualizado para versionCode 238.
- Novo workflow de CI executa verificação de sintaxe e testes antes da publicação.

## 2.3.0+executor-2
- Executor HTML: quando o Ollama falha, o aviso agora distingue "desligado" de "ligado mas bloqueado pelo navegador (CORS)", mostra o
  comando exato para Linux/Windows/Mac e oferece "Usar modo demonstracao". Seletor de modelo mostra "sem modelos" em vez de ficar vazio.
- Corrigido (frontend): o historico lateral nao listava a conversa quando a primeira resposta falhava.
- Corrigido: configuracoes gravadas com atraso podiam se perder se a pagina recarregasse logo em seguida.

## 2.3.0+executor
- NOVO `JARVES_EXECUTOR.html` (raiz do pacote): arquivo unico que abre com duplo clique, sem Node. Inclui um backend em JavaScript
  no navegador (`CORE/executor/browser-backend.js`) com conversas, memoria, arquivos, tarefas/agentes, configuracoes e diagnostico
  salvos em IndexedDB, chat com streaming para Ollama ou API compativel com OpenAI, backup/restauracao. Regenerar: `npm run build:executor`.
- Corrigido (frontend, vale tambem para a versao com servidor): na 1a mensagem de uma conversa nova o painel de boas-vindas
  continuava acima das mensagens e as sugestoes ficavam sobre o chat.
- Novos testes: `tests/unit/executor-build.test.mjs`.

## 2.3.0 - correcao de bugs, seguranca e build
Revisao completa do codigo (nao havia uma lista pronta de bugs). Detalhes e o que NAO foi verificado: `BUILD/RELATORIO_2.3.0.md`.

**Build / instalacao**
- Electron 33 (Node 20) nao tem `node:sqlite`: o EXE/AppImage abriria e fecharia na hora. Agora Electron ^37 (Node 22).
- `desktop/main.cjs`: `import()` de caminho do Windows (`C:\...`) falhava; usa `pathToFileURL`. Instancia unica, porta ocupada cai para porta livre, reabrir janela nao sobe o servidor de novo, navegacao externa bloqueada, SQLite fechado ao sair.
- `package.json`: faltava `author`/e-mail (o `.deb` falha sem isso), icone, `--publish never` (em tag o electron-builder tentava publicar), `test:unit`/`test:integration` nao funcionavam no Node 22 (diretorio no lugar de glob), `engines` 22.13 (SQLite sem flag).
- `GERAR_APK.sh`: a deteccao do JDK nunca casava e o script SEMPRE falhava com "JDK 17 necessario".
- Scripts Windows/Linux checam Node 22.13+; o navegador so abre depois do servidor subir.
- GitHub Actions agora roda lint + testes antes de compilar os 3 instaladores.

**Seguranca**
- `/api/diagnostics/fix` e `/backup` eram abertos e aceitavam QUALQUER caminho (sobrescrever qualquer arquivo do PC). Agora exigem `ADMIN_TOKEN` no header e so mexem dentro da pasta do programa (nunca `data`, `.env`, `.git`, `node_modules`).
- `applyFix` usava `replace(string)`: `$&`/`$1` no codigo corrigido corrompiam o arquivo.
- `/preview/:id` servia HTML enviado na mesma origem do app (XSS armazenado, lia `/api/settings`). Agora CSP sandbox; binarios saem intactos; inexistente = 404 (antes devolvia o index.html com 200).
- `adminGuard`: token na URL removido, comparacao em tempo constante.
- `CORS_ORIGIN` era ignorado; agora aplicado.
- Chave de criptografia perdida/trocada derrubava `/api/settings` e todo o chat (500); agora a chave e tratada como ausente.
- `RESEARCH_ENABLED=false` nao impedia a pesquisa web; agora bloqueia (403).
- `Permissions-Policy` bloqueava o microfone (botao de voz nunca funcionava).

**Chat / IA**
- Qualidade padrao `low` cortava toda resposta em 128 tokens (e quebrava o JSON do planejador). Padrao agora `medium` (1024).
- Ollama: chunk final `done` nunca emitido, linhas `{"error"}` engolidas (resposta vazia sem aviso), ultima linha sem `\n` descartada, timeout total matava geracoes longas (agora por inatividade) e aparecia como "aborted".
- Provedor OpenAI-compatible agora faz streaming de verdade (SSE).
- Chat: mensagem do usuario era gravada antes do 409 de `requestId` duplicado; cliente que fechava o SSE nao interrompia a geracao.
- Provedor/modelo ficavam "grudados" na tela apos mudar configuracoes; "Usar modelo" nao tinha efeito no chat.

**Tarefas / agentes**
- Cada etapa recebia so o titulo (sem objetivo nem resultados anteriores).
- Cancelar nao interrompia nada e o status final era sobrescrito por `done`; executar 2x em paralelo agora e recusado (409).
- Agente escolhido na tela Agentes era ignorado; provedor/modelo da requisicao eram ignorados pelos agentes.

**Dados / API**
- `/api/memory/search` e `/status` eram capturadas por `/:id` (sempre 404).
- Busca com `%`/`_` tratava como curinga; PATCH de memoria nao juntava `tags`; PATCH de conversa ignorava `agentId`; mensagens de conversa inexistente davam 500/[].
- Upload: limite JSON de 12 MB rejeitava arquivos de ~9-10 MB (base64); nomes com `..` no meio eram recusados; base64 invalido era aceito em silencio.
- Diagnostico: `npm test` sincrono travava o servidor por ate 3 min e relatorios iam para pasta somente leitura quando instalado.

**Frontend**
- Salvar Configuracoes falhava na 1a vez (campos vazios davam 400).
- Upload de arquivo > ~100 KB estourava a pilha (`btoa(String.fromCharCode(...bytes))`).
- Markdown formatava `**`/`` ` `` dentro de blocos de codigo; respostas perdiam as quebras de linha.
- `localStorage` sem try/catch derrubava o app em modo privado/WebView; Relatorios mostrava erro quando nao havia diagnostico; service worker registrado duas vezes; branding V1000/JERVER.

**Android**
- WebView sem `onShowFileChooser`: o botao de enviar arquivos nao funcionava no APK. Versao 2.3.0.

**Limpeza**
- Docs/relatorios legados (inclusive um que afirmava "0 bugs") movidos para `DOCUMENTACAO/arquivo-antigo/`.

## 1.0.0 - 2026-11-01
- Implementacao inicial do JERVER AI V1000 FREE ULTIMATE.
- Chat com streaming, historico e memoria.
- Agentes especializados e planejamento de tarefas.
- Gerenciador de arquivos e analise de codigo.
- Pesquisa web (best-effort).
- Testes unitarios, integracao e smoke.

## 1.0.1 — Atualização de estabilidade JARVES AI
- Corrigido o inicializador da pasta PC para executar o backend na pasta correta.
- Verificação de Node.js 22+ nos inicializadores.
- Melhorado diagnóstico de falhas de rede, incluindo endereço de origem e modo file://.
- Cabeçalho JSON enviado apenas quando há corpo; respostas HTTP exibem mensagens mais claras.
- IDs de recursos codificados nas rotas da API.
- Atualizadas instruções para acesso mobile pela mesma origem do backend.
