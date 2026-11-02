import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env, ROOT, ensureDirs, APP_VERSION } from './config/env.mjs';
import { securityHeaders, cors, errorHandler, adminGuard } from './middleware/security.mjs';
import { shouldAdvertiseLanHost, startJarvesLanDiscovery } from './services/lanDiscovery.mjs';
import healthRouter from './routes/health.mjs';
import convRouter from './routes/conversations.mjs';
import chatRouter from './routes/chat.mjs';
import modelsRouter from './routes/models.mjs';
import profilesRouter from './routes/profiles.mjs';
import settingsRouter from './routes/settings.mjs';
import memoryRouter from './routes/memory.mjs';
import filesRouter from './routes/files.mjs';
import tasksRouter from './routes/tasks.mjs';
import researchRouter from './routes/research.mjs';
import diagnosticsRouter from './routes/diagnostics.mjs';
import imagesRouter from './routes/images.mjs';
import robloxRouter from './routes/roblox.mjs';

ensureDirs();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(securityHeaders);
app.use(cors);
// O upload viaja em base64 (~4/3 do tamanho). O limite fixo de 12 MB rejeitava arquivos de ~9-10 MB
// que o proprio MAX_UPLOAD_BYTES permite.
const jsonLimit = Math.max(1024 * 1024, Math.ceil(env.MAX_UPLOAD_BYTES * 4 / 3) + 1024 * 1024);
app.use(express.json({ limit: jsonLimit }));
app.use(express.urlencoded({ extended: true }));

// static frontend
const frontendDir = path.join(ROOT, 'frontend');
app.use(express.static(frontendDir));

// API
app.use('/api/health', healthRouter);
app.use('/api/conversations', convRouter);
app.use('/api/chat', chatRouter);
app.use('/api/models', modelsRouter);
app.use('/api/profiles', profilesRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/memory', memoryRouter);
app.use('/api/files', filesRouter);
app.use('/api/tasks', adminGuard, tasksRouter);
app.use('/api/research', researchRouter);
app.use('/api/diagnostics', diagnosticsRouter);
app.use('/api/images', imagesRouter);
app.use('/api/roblox', robloxRouter);

// Public preview of uploaded file as site
// Pre-visualizacao de arquivo enviado. Conteudo do usuario NUNCA roda na origem do app:
// CSP sandbox (sem allow-same-origin) impede que um HTML enviado leia /api, configuracoes ou a chave.
const PREVIEW_TYPES = new Set(['text/html', 'text/plain', 'text/css', 'text/markdown', 'application/json', 'image/png', 'image/jpeg', 'image/gif', 'image/webp']);
app.get('/preview/:id', async (req, res) => {
  const { readFileBuffer } = await import('./services/fileService.mjs');
  let file;
  try { file = readFileBuffer(req.params.id); }
  catch { return res.status(404).send('Arquivo nao encontrado'); } // antes caia no fallback e devolvia o index.html com 200
  const mime = String(file.record.mime || '').split(';')[0].trim().toLowerCase();
  res.setHeader('Content-Type', PREVIEW_TYPES.has(mime) ? mime : 'text/plain; charset=utf-8');
  res.setHeader('Content-Security-Policy', "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(file.buffer);
});

// Public diagnostic report page
app.get('/diagnostico', async (req, res) => {
  const { exportReport } = await import('./services/diagnosticsService.mjs');
  const html = exportReport('html');
  if (!html) return res.status(404).send('Nenhum diagnostico. Execute em /api/diagnostics/run');
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

// Legacy mobile URL redirects to the same unified responsive application.
app.get('/mobile', (req, res) => res.redirect(301, '/'));
app.get('/mobile/*path', (req, res) => res.redirect(301, '/'));

// SPA fallback
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Rota nao encontrada' });
  if (req.method !== 'GET') return next();
  res.sendFile(path.join(frontendDir, 'index.html'));
});

app.use(errorHandler);

export default app;
export function startServer(port = env.PORT, host = env.HOST) {
  const server = app.listen(port, host, () => {
    if (process.env.NODE_ENV !== 'test') console.log(`JARVES AI ${APP_VERSION} rodando em http://${host}:${port}`);
    if (shouldAdvertiseLanHost(host)) {
      const discoveryPort = server.address()?.port;
      if (typeof discoveryPort === 'number') {
        const stopDiscovery = startJarvesLanDiscovery(discoveryPort, APP_VERSION);
        server.once('close', stopDiscovery);
      }
    }
  });
  return server;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  startServer();
  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
}
