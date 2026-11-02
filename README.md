# JARVES AI 2.4.2 — IA local Android + Roblox Studio

Repositorio-fonte preparado a partir do pacote Windows enviado.

## O que há aqui
- Aplicação web JARVES (frontend HTML/CSS/JS + backend Node/Express).
- Relatório técnico de auditoria em TXT e JSON.
- Testes smoke e verificação de sintaxe JavaScript.
- Aplicativo Android com chat local LiteRT-LM e cliente WebView opcional para o servidor do PC.
- GitHub Actions compilam APK, EXE e AppImage como artefatos. Ao enviar uma tag `v*`, os três arquivos são anexados à Release correspondente no GitHub.
- **Arquivos e código** importa arquivos locais e baixa arquivos de links HTTP/HTTPS públicos; os bytes são preservados e os downloads respeitam o limite configurado para uploads.
- A integração Roblox Studio usa um plugin local e uma fila autenticada em loopback. Cada script exige aprovação dentro do Studio antes de ser inserido; o JARVES não executa código Luau.
- Ferramentas ficam no painel **Atalhos** do Chat; a geração de PNG usa um modelo Automatic1111/Forge local configurado pelo usuário. Um som curto opcional avisa quando a resposta termina.
- Roblox Studio é oficialmente disponível para Windows e macOS. No Linux, executar via Wine é uma alternativa não oficial, sem garantia de compatibilidade.

## Executar o servidor
Requisitos: Node.js 22.13 ou superior.

```bash
npm install
npm run check
npm test
HOST=0.0.0.0 npm start
```

Abra `http://localhost:3000` no computador.

## Android
O APK inclui LiteRT-LM e oferece chat com inferência no próprio celular, sem PC e sem chave de API. Os pesos não vêm dentro do APK: no primeiro uso, a pessoa escolhe baixar o Gemma 4 E2B oficial (2.588.147.712 bytes) do Hugging Face. O app valida o SHA-256 do arquivo e mantém o download parcial para retomada.

1. Instale o APK e abra **IA local**.
2. Toque em **Baixar modelo (2,59 GB)**. Recomenda-se Wi-Fi e pelo menos 3,2 GB livres no armazenamento privado do app.
3. Após o download, toque em **Iniciar modelo local**. O primeiro carregamento pode levar alguns segundos; recomenda-se aparelho com 6 GB ou mais de RAM.
4. Selecione Chat, Código, Resumo, Traduzir ou Plano. O chat e seu histórico ficam no telefone; depois de baixar o modelo, a inferência não exige internet.

O modelo selecionado é `litert-community/gemma-4-E2B-it-litert-lm`, licença Apache-2.0, fixado no commit `1caa527c1e88b55f046fcd8d2b4265606680663d`. A versão móvel usa o backend CPU para compatibilidade ampla; velocidade e estabilidade dependem do hardware. O benchmark publicado para um Galaxy S26 Ultra mediu cerca de 1,7 GB de RAM de CPU; aparelhos com pouca memória podem fechar o app ou ficar lentos. O app avisa quando a RAM total está abaixo da recomendação, mas não garante desempenho em todos os celulares.

A inferência local requer Android 64-bit (a biblioteca nativa incluída fornece `arm64-v8a` e `x86_64`). Em aparelhos Android 32-bit, o modo local não fica disponível; o cliente opcional do servidor do PC continua preservado.

O modo **Servidor** continua opcional e conecta a interface web do JARVES/Ollama no PC:
1. Inicie o JARVES no PC com `HOST=0.0.0.0 npm start` para habilitar o anúncio de descoberta na rede local.
2. No Android, conecte-se à mesma rede Wi-Fi. O APK procura automaticamente o servidor anunciado e valida `/api/health`.
3. Em Configurações, informe `http://<IP-do-PC>:3000` se a descoberta falhar.

A descoberta usa mDNS (`_jarves._tcp`) e só é anunciada quando o backend escuta em todas as interfaces ou num endereço local privado. O APK não liga o Wi-Fi nem ingressa numa rede protegida; ambos os aparelhos precisam estar na mesma rede local e a rede deve permitir tráfego entre dispositivos. A versão desktop instalada mantém o backend limitado a `127.0.0.1`; para conectar o APK, inicie o servidor Node em modo LAN conforme o passo 1.

## IA sem cobrança por uso
- Escolha **Ollama local** (ou **Automático**) em Configurações e instale um modelo compatível. A inferência fica no seu PC/servidor e não exige uma chave de API paga.
- O download inicial precisa de internet e ocupa espaço em disco; a execução usa memória, processador/placa de vídeo e energia do seu equipamento. A licença de cada modelo pode variar.
- Se Ollama não estiver disponível, Automático usa `jarves-base`, uma resposta offline básica e limitada, não um modelo generativo completo.
- Provedores remotos compatíveis podem cobrar e exigem acesso próprio. **GPT-6.1 Sol** tem o identificador `gpt-6.1-sol`, suporta Chat Completions, mas é um modelo de API pago; ele só pode ser selecionado se o endpoint remoto configurado o listar. A lista de modelos é obtida dinamicamente, sem fingir suporte ou adicioná-lo como opção grátis. Consulte [documentação e preços oficiais](https://developers.openai.com/api/docs/models/gpt-6.1-sol).

## Gerar APK pelo GitHub
1. Envie todos os arquivos desta pasta para [`p59784166-cloud/jarves`](https://github.com/p59784166-cloud/jarves).
2. Abra **Actions** e execute **Build JARVES Android APK** (workflow_dispatch). Pushes com mudanças Android, frontend, backend ou motores de IA também compilam o APK como artefato do workflow.
3. Baixe o APK Android nos Artifacts da execução.
4. Para publicar o APK em Releases, crie e envie uma tag da versão atual do app.

A página local de downloads está em `/download.html` quando o servidor JARVES está em execução. Após publicar os arquivos e concluir o workflow **Publish JARVES downloads site**, o site do GitHub Pages será `https://p59784166-cloud.github.io/jarves/`. A página consulta as Releases desse repositório e só habilita botões depois de encontrar os assets reais `app-debug.apk`, `JARVES-AI-Setup-<versão>-x64.exe` e `JARVES-AI-<versão>-x86_64.AppImage`. Os workflows de Android, Windows e Linux anexam seus instaladores à Release quando uma tag `v*` é enviada. O APK é uma compilação de depuração; o EXE não é assinado. O repositório alvo ainda precisa receber o código e a primeira Release antes que esse link ofereça downloads.

## Gerar instalador Windows
- Execute `npm ci` e `npm run build:windows` em Windows com Node.js 22.13+. O instalador NSIS será criado em `dist/`.
- O workflow **Build JARVES Windows EXE** compila o instalador em cada push que altera o app e o publica como artefato do Actions; tags `v*` também o anexam à Release correspondente.
- O instalador ainda não tem assinatura de código; o Windows pode mostrar avisos do SmartScreen.

## Gerar AppImage para Linux
- Requer Node.js 22.13+; execute `npm ci` e `npm run build:linux` para criar `dist/JARVES-AI-2.4.2-x86_64.AppImage`.
- O workflow **Build JARVES Linux AppImage** gera o mesmo pacote x86_64, publica-o como artefato do Actions e o anexa à Release nas tags `v*`.
- Os pacotes Electron incluem o diretório `executor/`, usado pelo provedor de IA, e usam ícones de aplicativo específicos para Linux e Windows. O APK inclui ícones de launcher em todas as densidades Android.

## Conectar ao Roblox Studio
1. Inicie o JARVES Desktop e abra **Ferramentas → Roblox Studio**. Gere um token e copie o endereço e o token mostrados.
2. No Roblox Studio, crie um Script temporário em `ServerStorage`, cole o conteúdo de `frontend/roblox-plugin/JARVESStudioPlugin.lua`, selecione-o no Explorer e escolha **Plugins → Save as Local Plugin**. Apague o Script temporário depois de salvar o plugin.
3. Na aba **Plugins**, abra **JARVES Studio Bridge**, cole o endereço local e o token e conecte. O Studio pode pedir permissão para HTTP local; permita se quiser usar a ponte.
4. No JARVES, cole o código Luau revisado, escolha o destino e envie. Confira a prévia e clique em **Insert into Studio** no plugin. Salve o projeto Roblox manualmente.

O token é aleatório, aceito somente por conexões de loopback, mantido em memória e invalidado ao reiniciar o JARVES ou gerar outro token. A fila não persiste após reiniciar. Só são permitidos `Script` em `ServerScriptService`, `LocalScript` em `StarterPlayerScripts` e `ModuleScript` em `ReplicatedStorage`; a ponte não executa código no JARVES.

A Roblox documenta Studio para Windows e macOS, não Linux. No Linux, só é possível tentar executar Studio por Wine ou outra camada de compatibilidade não oficial; a ponte do JARVES não instala nem oferece suporte oficial ao Roblox Studio para Linux.

## Interface, voz e correção assistida
- O Chat desktop reúne acesso ao Gerador, Voz e vídeo, Testes HTML, Relatórios, Agentes, Tarefas, Arquivos, Memória e Configurações no painel **Ferramentas**. O chat local Android oferece modos Chat, Código, Resumo, Traduzir e Plano.
- A opção **Unificar conversas** cria um Chat unificado com cópias cronológicas das mensagens de todos os históricos, incluindo o nome de origem; as conversas originais permanecem intactas. Pode ser usada novamente para acrescentar mensagens novas sem duplicar as já importadas.
- O botão **Voz** no Chat transcreve pedidos e aceita os comandos “enviar”, “limpar texto”, “novo chat” e “parar resposta”. No Android usa o reconhecedor do sistema após pedir permissão de microfone; no navegador depende do suporte e do serviço de voz instalado. O reconhecimento pode exigir internet e não é garantidamente offline; pedidos ditados são transcritos para revisão antes de enviar, exceto quando a pessoa diz “enviar”.
- Em Configurações é possível personalizar nome da IA, cor principal, efeito RGB, tema, voz/idioma e velocidade/tom da síntese de fala disponíveis no dispositivo. O estilo de resposta e instruções próprias também podem ser salvos localmente; o texto dessas instruções é enviado ao provedor escolhido junto com cada mensagem. Síntese e reconhecimento não alteram a voz textual do modelo.
- No Chat, os comandos locais `/ajuda`, `/tema claro|escuro`, `/cor #RRGGBB`, `/voz pt-BR|pt-PT|en-US|es-ES`, `/estilo breve|equilibrado|detalhado|codigo`, `/nome texto`, `/instrucoes texto`, `/som ligar|desligar` e `/modelo nome` personalizam preferências sem enviar o comando ao modelo. O comando de modelo só aceita modelos já disponíveis.
- Também é possível carregar uma imagem PNG/JPG/WebP de até 5 MB, que é recortada e reduzida para 256×256 antes de ser guardada localmente e exibida como avatar da IA. No APK, Configurações também permite alternar entre dois ícones de launcher incluídos no pacote; imagens enviadas mudam o avatar dentro do app, mas não recompilam o ícone instalado.
- A aba Voz e vídeo lê texto com a voz instalada, pode reproduzir junto um vídeo local e exporta o roteiro como TXT. O vídeo não é enviado, mas a voz não é incorporada/exportada no MP4; não existe um motor local de geração/edição de vídeo nesta versão.
- Em **Arquivos e código**, o app importa arquivos do dispositivo e baixa arquivos de links HTTP/HTTPS públicos para o armazenamento local do JARVES. O download da rede usa o limite configurado para uploads; bloqueia loopback, IPs privados/locais e domínios que resolvam para esses endereços, limita redirecionamentos e não executa o conteúdo. Os bytes são gravados em fluxo para não carregar todo o arquivo na memória. Downloads e exportações mantêm os bytes originais.
- A aba **Testes HTML** executa verificações locais da interface e consulta diagnósticos do servidor; **Relatórios** mostra o último resumo e permite exportar TXT/JSON. É possível fornecer um arquivo de texto/código nas Configurações para preparar uma solicitação de análise no Chat. A IA sugere correções em texto; não executa código nem modifica arquivos automaticamente.
- O **Gerador** cria imagens vetoriais SVG 2D offline, malhas geométricas simples em OBJ/MTL e GLB, e um visualizador HTML local que gira o modelo ao arrastar. Com Ollama local, também pode produzir projetos textuais em HTML, CSS, JavaScript, TypeScript, Python, Java, C, C++, PHP, JSON, XML, GDScript e Shell; os arquivos têm nomes e tamanhos validados, podem ser baixados em ZIP e não são executados nem compilados automaticamente. A sintaxe é verificada somente para JavaScript e JSON pela ferramenta de análise; outras linguagens exigem compiladores/validadores instalados pelo usuário. Revise código gerado antes de usar.
- Para imagens rasterizadas geradas por IA, escolha **IA de imagem local (Automatic1111/Forge)** e configure um servidor local compatível com a API de Stable Diffusion WebUI; inicie-o com a API habilitada (por exemplo, `--api`). O JARVES encaminha o pedido ao computador/servidor configurado e oferece o PNG para baixar ou salvar. Não há cobrança por API nem chamada a serviço de nuvem, mas é preciso instalar o motor, baixar um modelo e ter recursos de hardware e energia; modelos podem ter licenças diferentes. Por segurança, o endereço só pode ser HTTP em loopback ou rede privada. Ollama local pode escolher a forma/cor ou gerar HTML; se não estiver disponível, o gerador informa a limitação e usa o modo offline. A geração de malhas continua procedural e limitada a cubo, esfera, cilindro e cone. A prévia de HTML usa iframe sandbox e não executa no contexto principal do app.
- O fluxo de criação em Configurações encadeia pesquisa web opcional, geração de plano, confirmação e execução manual de etapas de IA. A pesquisa é desativada por padrão e envia a consulta ao DuckDuckGo quando ativada; o modelo usa o provedor selecionado. Etapas produzem conteúdo/código para revisão, não executam comandos nem compilam aplicativos; blocos HTML podem ser pré-visualizados em iframe isolado.
- Provedores locais Ollama evitam cobrança por chamada, mas usam hardware local e podem exigir baixar modelos; uma IA remota ou voz não instalada não é tornada gratuita por esta interface.
- Grok não foi adicionado como opção “100% grátis”: a [API oficial xAI](https://docs.x.ai/developers/pricing) publica cobrança por tokens e por imagem. A geração local incluída não chama essa API.

## Limites conhecidos
- O APK de depuração é compilado pelo GitHub Actions com Java 17, Android SDK, Gradle 8.9, Kotlin 2.4.0 e LiteRT-LM 0.19.0.
- O EXE Windows não foi executado neste ambiente Linux.
- Não é correto afirmar que todos os bugs foram eliminados. Consulte `RELATORIO_ERROS_CORRECOES.txt`.
