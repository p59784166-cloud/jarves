# Arquitetura - JERVER AI V1000 FREE ULTIMATE

## Componentes
- Frontend: HTML/CSS/JS servido estaticamente.
- Backend: Express (Node.js) com rotas REST e SSE.
- IA: adaptadores por provedor (Ollama, OpenAI-compatible, mock) com camada comum.
- Memoria: SQLite (conversas, mensagens, memorias, settings, arquivos, tarefas).
- Agentes: 10 agentes genericos com prompts e orquestracao.
- Ferramentas: arquivos, pesquisa, analise de codigo.

## Comunicacao frontend-backend
- REST JSON para CRUD.
- SSE para streaming de chat.

## Provedores
- Selecao respeitada via provider/model no request e settings.

## Memoria
- Historico de conversas separado de memoria de longo prazo.
- FTS5 para busca quando disponivel.

## Agentes
- Coordenador seleciona agentes por palavras-chave.
- Limites de etapas (max 10).

## Ferramentas
- Upload validado, leitura de texto, analise estatica.
