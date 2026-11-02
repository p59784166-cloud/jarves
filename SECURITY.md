# Segurança - JARVES AI

## Modelo de segurança
- Backend Node.js local; frontend estático.
- Validação de entradas nas rotas.
- SQL parametrizado (node:sqlite).
- Escape HTML no frontend (renderização segura).
- Proteção contra traversal de diretórios em uploads.
- Limites de tamanho de upload.
- Timeout em chamadas de IA.
- Credenciais apenas via .env / settings (não expostas no JS público; API key mascarada na listagem).

## Mudancas da 2.2.1
- Rotas que editam arquivos exigem ADMIN_TOKEN (header) e ficam restritas a pasta do programa.
- Pre-visualizacao de arquivos enviados roda em CSP sandbox, isolada da origem do app.
- CORS so quando CORS_ORIGIN estiver definido. Pesquisa web desligada por padrao.

## Limitações
- Sem autenticação de usuários por padrão (ambiente local).
- ADMIN_TOKEN opcional para rotas administrativas.
- Pesquisa web depende de rede e pode falhar.
- Execução de código gerado não é automática; análise estática apenas.

## Gestão de credenciais
- Use .env (não commitado). Veja .env.example.
- Não armazene chaves em memória comum.

## Comunicação de vulnerabilidades
- Reporte via issues do projeto ou e-mail do mantenedor.
