// Gera ../JARVES_EXECUTOR.html: o frontend + backend de navegador num unico arquivo (abre com duplo clique).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fe = path.join(root, 'frontend');
const out = path.resolve(root, '..', 'JARVES_EXECUTOR.html');
const read = (p) => fs.readFileSync(p, 'utf8');
const safeScript = (code, name) => {
  if (/<\/script/i.test(code)) throw new Error(`${name} contem "</script" e quebraria o HTML`);
  return code;
};

fs.copyFileSync(path.join(root, 'executor/base-engine.js'), path.join(fe, 'scripts/base-engine.js')); // uma unica fonte do motor
let html = read(path.join(fe, 'index.html'));
const icon = 'data:image/png;base64,' + fs.readFileSync(path.join(fe, 'assets/icon-192.png')).toString('base64');
const replaceOnce = (from, to) => {
  if (!html.includes(from)) throw new Error('Trecho nao encontrado no index.html: ' + from.slice(0, 60));
  html = html.replace(from, () => to);
};

replaceOnce('<link rel="manifest" href="/manifest.json">\n', '');
replaceOnce('<link rel="icon" href="/assets/icon-192.png">', `<link rel="icon" href="${icon}">`);
replaceOnce('<link rel="stylesheet" href="/styles/main.css">', `<style>\n${read(path.join(fe, 'styles/main.css'))}\n</style>`);
html = html.replace('class="brand" href="/"', 'class="brand" href="#"');

const order = ['api.js', 'state.js', 'ui.js', 'particles.js', 'app.js', 'base-engine.js', 'gerador.js', 'html-tests.js', 'roblox-studio.js'];
const tagLine = order.map(f => `<script src="/scripts/${f}"></script>`).join('');
const inline = [
  `<script>\n${safeScript(read(path.join(root, 'executor/base-engine.js')), 'base-engine.js')}\n</script>`,
  `<script>\n${safeScript(read(path.join(root, 'executor/browser-backend.js')), 'browser-backend.js')}\n</script>`,
  ...order.filter(f => f !== 'base-engine.js').map(f => `<script>\n${safeScript(read(path.join(fe, 'scripts', f)), f)}\n</script>`),
].join('\n');
replaceOnce(tagLine, inline);

if (/(src|href)="\/(scripts|styles|assets|manifest)/.test(html)) throw new Error('Sobrou referencia a arquivo externo');
fs.writeFileSync(out, html);
// APK: o app Android embute o mesmo arquivo (funciona sem servidor)
const apkAssets = path.resolve(root, '..', 'ANDROID_APK/app/src/main/assets');
if (fs.existsSync(path.resolve(root, '..', 'ANDROID_APK'))) { fs.mkdirSync(apkAssets, { recursive: true }); fs.writeFileSync(path.join(apkAssets, 'jarves.html'), html); }
console.log(`Gerado ${out} (${(html.length / 1024).toFixed(0)} KB)`);
