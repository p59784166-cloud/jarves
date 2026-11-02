const { app, BrowserWindow, shell, dialog } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let server;
let mainWindow;
let booting = false;
let appUrl = null;

// Uma unica instancia: abrir o app duas vezes disputava a porta e mostrava erro.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
  });
}

function listen(backend, port) {
  return new Promise((resolve, reject) => {
    const s = backend.startServer(port, '127.0.0.1');
    s.once('listening', () => resolve(s));
    s.once('error', reject);
  });
}

async function startBackend() {
  process.env.HOST = '127.0.0.1';
  process.env.NODE_ENV = process.env.NODE_ENV || (app.isPackaged ? 'production' : 'development');
  // Instalado em Program Files/AppImage a pasta do programa e somente leitura: dados vao para userData.
  const userData = app.getPath('userData');
  process.env.DB_PATH = process.env.DB_PATH || path.join(userData, 'data', 'jarves.db');
  process.env.UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(userData, 'data', 'uploads');
  // import() de caminho absoluto do Windows ("C:\...") falha com ERR_UNSUPPORTED_ESM_URL_SCHEME;
  // e preciso converter para file:// URL.
  const backend = await import(pathToFileURL(path.join(__dirname, '..', 'backend', 'server.mjs')).href);
  const preferred = Number(process.env.PORT || 3210);
  try { server = await listen(backend, preferred); }
  catch (e) {
    if (e.code !== 'EADDRINUSE') throw e;
    server = await listen(backend, 0); // porta ocupada: deixa o sistema escolher uma livre
  }
  return `http://127.0.0.1:${server.address().port}`;
}

async function boot() {
  if (booting) return;
  booting = true;
  try {
    if (!appUrl) appUrl = await startBackend(); // reabrir a janela (macOS) nao sobe o servidor de novo
    mainWindow = new BrowserWindow({
      width: 1360, height: 900, minWidth: 800, minHeight: 600, autoHideMenuBar: true,
      icon: path.join(__dirname, '..', 'build', 'icon.png'),
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    mainWindow.on('closed', () => { mainWindow = null; });
    const openExternal = (target) => {
      try { const p = new URL(target); if (p.protocol === 'https:' || p.protocol === 'http:') shell.openExternal(target); }
      catch { /* URL invalida */ }
    };
    mainWindow.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
    // Links dentro da pagina nao podem navegar a janela do app para sites externos.
    mainWindow.webContents.on('will-navigate', (event, target) => {
      if (!target.startsWith(appUrl)) { event.preventDefault(); openExternal(target); }
    });
    await mainWindow.loadURL(appUrl);
  } catch (error) {
    console.error('Falha ao iniciar JARVES AI:', error);
    await dialog.showMessageBox({
      type: 'error',
      title: 'JARVES AI não iniciou',
      message: 'Não foi possível iniciar o servidor local.',
      detail: `${error.message || error}\nVerifique as dependências e tente novamente.`,
    });
    app.quit();
  } finally { booting = false; }
}

if (gotLock) app.whenReady().then(boot);
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) boot(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => {
  try { if (server?.listening) server.close(); } catch { /* ja encerrado */ }
  import(pathToFileURL(path.join(__dirname, '..', 'backend', 'services', 'db.mjs')).href)
    .then(m => m.closeDb()).catch(() => {}); // fecha o SQLite (WAL) com seguranca
});
