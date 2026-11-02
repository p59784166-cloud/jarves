# JARVES AI 2.1 — Gerenciador de provedores, modelos e chaves

## O que mudou
- Nova área de configurações com abas Conexão, Modelos IA e API keys.
- Consulta de modelos do provedor ativo.
- Seleção de um modelo da lista e gravação da preferência.
- Instalação de modelos Ollama pelo endpoint `/api/pull`.
- Cadastro e remoção de chave para provedores compatíveis com OpenAI.
- API key mascarada nas respostas HTTP e não exibida novamente na interface.
- Chave API protegida com AES-256-GCM em repouso; a chave de proteção local fica em `data/.jarves-secret` (ou na pasta de dados do usuário no desktop).
- Migração automática de chaves antigas em texto simples quando forem lidas.
- Validação de URL e limite de tamanho da chave.

## Configurar Ollama
1. Instale e inicie Ollama no computador que executa o backend.
2. Em Configurações > Conexão, informe a URL Ollama (normalmente `http://127.0.0.1:11434`).
3. Abra Modelos IA, digite um nome de modelo existente no catálogo Ollama, por exemplo `qwen3.5:4b`, e escolha Baixar modelo.
4. Quando aparecer na lista, clique em Usar modelo.

O download depende da internet e do espaço livre em disco. Os nomes e versões disponíveis podem variar.

## Configurar provedor remoto
1. Crie a API key no painel oficial do provedor escolhido. O JARVES não emite credenciais de terceiros.
2. Em Conexão, selecione `openai-compatible`, informe o endpoint base terminado normalmente em `/v1` e o identificador exato do modelo.
3. Em API keys, cole a chave e clique Salvar chave.
4. Volte a Conexão e clique Testar conexão.

A chave é armazenada no banco local cifrada com AES-256-GCM. Faça backup de `data/.jarves-secret` junto com o banco se precisar migrar as configurações para outro computador. Nunca compartilhe esse arquivo nem o banco com terceiros.

## Celular
O APK Android funciona como cliente WebView e precisa de um backend JARVES acessível pela rede. Inicie o backend no PC/Linux, mantenha os dois dispositivos na mesma rede e informe no APK o endereço local do computador, por exemplo `http://192.168.x.x:3000`. Não use `127.0.0.1` no celular para apontar ao computador.

## Limites de compilação
EXE, AppImage/DEB e APK são artefatos específicos de plataforma. A compilação exige dependências de sistema, SDK/Gradle, Electron Builder e acesso aos pacotes necessários. O ambiente desta revisão não tinha dependências npm instaladas, Gradle, Android SDK, Wine ou appimagetool; por isso os fontes e scripts foram preparados, mas não é possível declarar binários finais compilados nesta execução.
