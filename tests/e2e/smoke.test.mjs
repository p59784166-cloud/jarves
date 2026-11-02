import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());

test('frontend index exists and has key controls', () => {
  const html = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
  for (const id of ['btnMenu','btnNewChat','btnUnifyChats','btnSend','btnStop','btnClear','modelSelect','btnSaveSettings','btnUpload','btnDownloadNetworkFile','networkFileUrl','btnPlan','btnRunTask']) {
    assert.ok(html.includes('id="' + id + '"'), 'missing ' + id);
  }
  const navigation = html.match(/<nav class="tool-nav primary-nav"[\s\S]*?<\/nav>/)?.[0] || '';
  assert.deepEqual([...navigation.matchAll(/data-view="([^"]+)"/g)].map(match => match[1]), ['chat']);
  const chatTools = html.match(/<section class="chat-tools[\s\S]*?<\/section>/)?.[0] || '';
  assert.deepEqual([...chatTools.matchAll(/data-chat-tool="([^"]+)"/g)].map(match => match[1]), ['gerador', 'voice-studio', 'html-tests', 'reports', 'agents', 'tasks', 'files', 'memory', 'roblox-studio', 'settings']);
  for (const id of ['view-roblox-studio','btnRobloxPair','robloxBridgeAddress','robloxBridgeToken','btnCopyRobloxToken','robloxScriptName','robloxScriptTarget','robloxScriptSource','btnQueueRobloxScript']) {
    assert.ok(html.includes(`id="${id}"`), 'missing Roblox Studio control ' + id);
  }
  assert.match(html, /Plugins → Save as Local Plugin/);
  assert.match(html, /Wine não é suportado oficialmente/);
  for (const id of ['btnChatTools','btnCloseChatTools','btnBackToChat','chatTools','btnVoice','voiceCommandStatus']) assert.ok(html.includes(`id="${id}"`), 'missing unified chat control ' + id);
  assert.match(html, /id="view-html-tests"[\s\S]*id="btnRunHtmlTests"/);
  const generator = fs.readFileSync(path.join(root, 'frontend/scripts/gerador.js'), 'utf8');
  assert.match(generator, /value="modelo-3d"/);
  assert.match(generator, /Automatic1111\/Forge/);
  assert.match(generator, /generateImage\(\{ prompt, width: 768, height: 768, steps: 20 \}\)/);
  assert.match(generator, /encoding: 'base64'/);
  assert.match(generator, /provider: 'ollama'/);
  assert.doesNotMatch(generator, /nav\.insertBefore/);
  assert.match(navigation, /href="\/download\.html"/);
  for (const id of ['aiDisplayName','accentColor','rgbMode','aiAvatarInput','aiAvatarPreview','btnResetAiAvatar','launcherIcon','launcherIconStatus','androidServerPanel','androidServerUrl','btnConnectAndroidServer','androidServerStatus','speechLanguage','speechVoice','speechRate','speechPitch','btnTestVoice','btnRunHtmlTests','btnRunDiag','repairInput','repairFile','btnAskFix','workflowGoal','btnWorkflowResearch','btnWorkflowPlan','btnWorkflowCreate','btnWorkflowExecute','btnWorkflowPreview','workflowPreview','studioNarration','studioVideoFile','studioVideo','btnSpeakNarration','btnPlayAndSpeak']) {
    assert.ok(html.includes(`id="${id}"`), 'missing preference/diagnostic control ' + id);
  }
  const appScript = fs.readFileSync(path.join(root, 'frontend/scripts/app.js'), 'utf8');
  const robloxScript = fs.readFileSync(path.join(root, 'frontend/scripts/roblox-studio.js'), 'utf8');
  const robloxPlugin = fs.readFileSync(path.join(root, 'frontend/roblox-plugin/JARVESStudioPlugin.lua'), 'utf8');
  assert.match(robloxScript, /robloxPair\(\)/);
  assert.match(robloxScript, /robloxQueue\(token/);
  assert.match(robloxPlugin, /Insert into Studio/);
  assert.match(robloxPlugin, /ChangeHistoryService:SetWaypoint/);
  assert.match(robloxPlugin, /ServerScriptService/);
  assert.match(robloxPlugin, /StarterPlayerScripts/);
  assert.match(robloxPlugin, /ReplicatedStorage/);
  assert.match(appScript, /api\.downloadFile\(url\)/);
  assert.match(html, /Hospedar o backend e executar a IA dentro do próprio Android ainda não é suportado/);
  for (const command of ['enviar','limpar texto','novo chat','parar resposta']) assert.ok(html.includes(command), `missing voice command hint: ${command}`);
  assert.match(appScript, /connectToServer\(address\)/);
  assert.match(appScript, /androidBridge\.getServerStatus\(\)/);
  for (const command of ['enviar mensagem','limpar texto','nova conversa','parar resposta']) assert.ok(appScript.includes(command), `missing voice command handler: ${command}`);
  assert.match(appScript, /SpeechRec/);
  assert.match(appScript, /startVoiceRecognition\(preferences\.speechLanguage\)/);
  assert.match(appScript, /area\.appendChild\(welcome\);\s*applyPreferences\(\);/);
});

test('download page only enables APK, EXE, and AppImage downloads from a published GitHub release', () => {
  const html = fs.readFileSync(path.join(root, 'frontend/download.html'), 'utf8');
  assert.match(html, /const repository = 'p59784166-cloud\/jarves'/);
  assert.equal((html.match(/href="\.\/"/g) || []).length, 1);
  assert.match(html, /href="https:\/\/github\.com\/p59784166-cloud\/jarves">Ver código-fonte/);
  assert.match(html, /Os botões só aparecem quando o GitHub publica um arquivo real na Release/);
  assert.match(html, /WebView[\s\S]*Não executa Ollama no celular/);
  assert.match(html, /Sem links inventados/);
  assert.match(html, /api\.github\.com\/repos\/\$\{repository\}\/releases\/latest/);
  assert.match(html, /asset\.name === 'app-debug\.apk'/);
  assert.match(html, /id="exe-link"/);
  assert.match(html, /JARVES-AI-Setup-.*x64\\\.exe/);
  assert.match(html, /JARVES-AI-.+-x86_64\\\.AppImage/);
  assert.match(html, /id="app-link"/);
  assert.match(html, /link\.classList\.add\('is-ready'\)/);
});

test('Linux packaging builds only an x64 AppImage and uploads it from CI', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/linux-appimage.yml'), 'utf8');
  const windowsWorkflow = fs.readFileSync(path.join(root, '.github/workflows/windows-exe.yml'), 'utf8');
  assert.match(packageJson.scripts['build:linux'], /--linux AppImage --x64/);
  assert.deepEqual(packageJson.build.linux.target, [{ target: 'AppImage', arch: ['x64'] }]);
  assert.ok(packageJson.build.files.includes('executor/**/*'));
  assert.match(fs.readFileSync(path.join(root, 'ai/providers/base.mjs'), 'utf8'), /import ['"]\.\.\/\.\.\/executor\/base-engine\.js['"]/);
  assert.equal(packageJson.build.linux.icon, 'build/icon.png');
  assert.equal(packageJson.build.win.icon, 'build/icon.ico');
  const manifest = fs.readFileSync(path.join(root, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
  assert.match(manifest, /android\.speech\.RecognitionService/);
  assert.match(manifest, /android:icon="@mipmap\/ic_launcher"/);
  assert.match(manifest, /android:name="\.RobotLauncher"/);
  const androidActivity = fs.readFileSync(path.join(root, 'android/app/src/main/java/com/jarves/ai/MainActivity.java'), 'utf8');
  assert.match(androidActivity, /addJavascriptInterface\(new NativeSettingsBridge\(\), "JarvesAndroid"\)/);
  assert.match(androidActivity, /onShowFileChooser/);
  const appScript = fs.readFileSync(path.join(root, 'frontend/scripts/app.js'), 'utf8');
  assert.match(appScript, /createImageBitmap\(file\)/);
  assert.match(appScript, /500_000/);
  assert.match(workflow, /npm run build:linux/);
  assert.match(workflow, /dist\/\*\.AppImage/);
  for (const releaseWorkflow of [workflow, windowsWorkflow]) {
    assert.match(releaseWorkflow, /tags: \['v\*'\]/);
    assert.match(releaseWorkflow, /softprops\/action-gh-release@v2/);
    assert.match(releaseWorkflow, /fail_on_unmatched_files: true/);
  }
});

test('Android launcher icons target the declared activity and expose only packaged choices', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const androidBuild = fs.readFileSync(path.join(root, 'android/app/build.gradle'), 'utf8');
  const environment = fs.readFileSync(path.join(root, 'backend/config/env.mjs'), 'utf8');
  assert.equal(packageJson.version, '2.3.8');
  assert.match(androidBuild, /versionCode 238[\s\S]*versionName '2\.3\.8'/);
  assert.match(environment, /APP_VERSION = '2\.3\.8'/);
  const manifest = fs.readFileSync(path.join(root, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
  for (const permission of ['INTERNET', 'ACCESS_NETWORK_STATE', 'ACCESS_WIFI_STATE', 'CHANGE_NETWORK_STATE', 'CHANGE_WIFI_MULTICAST_STATE', 'RECORD_AUDIO']) {
    assert.match(manifest, new RegExp(`android:name="android\\.permission\\.${permission}"`));
  }
  const activityIndex = manifest.indexOf('android:name=".MainActivity"');
  assert.notEqual(activityIndex, -1);
  for (const alias of ['.DefaultLauncher', '.RobotLauncher']) {
    const aliasIndex = manifest.indexOf(`android:name="${alias}"`);
    assert.ok(aliasIndex > activityIndex, `${alias} must follow its target activity`);
    assert.match(manifest.slice(aliasIndex, aliasIndex + 260), /android:targetActivity="\.MainActivity"/);
  }
  const activity = fs.readFileSync(path.join(root, 'android/app/src/main/java/com/jarves/ai/MainActivity.java'), 'utf8');
  assert.match(activity, /"default"\.equals\(requestedIcon\).*?"robot"\.equals\(requestedIcon\)/s);
  assert.match(activity, /discoverServices\(JARVES_SERVICE_TYPE/);
  assert.match(activity, /verifyJarvesServer\(serverUrl, generation\)/);
  assert.match(activity, /getNetworkCapabilities\(network\)/);
  assert.match(activity, /addTransportType\(NetworkCapabilities\.TRANSPORT_WIFI\)/);
  assert.match(activity, /bindProcessToNetwork\(network\)/);
  assert.match(activity, /verifyManualServer\(pendingServerUrl\)/);
  assert.match(activity, /checkServerHealth\(serverUrl, network\)/);
  assert.match(activity, /getServerUrl\(\)/);
  assert.match(activity, /connectToServer\(String address\)/);
  assert.match(activity, /getServerStatus\(\)/);
  assert.match(activity, /startVoiceRecognition\(String language\)/);
  assert.match(activity, /SpeechRecognizer\.createSpeechRecognizer\(this\)/);
  assert.match(activity, /REQUEST_AUDIO_PERMISSION/);
  const discovery = fs.readFileSync(path.join(root, 'backend/services/lanDiscovery.mjs'), 'utf8');
  assert.match(discovery, /type: 'jarves'/);
  assert.match(discovery, /txt: \{ app: 'jarves-ai', version \}/);
  for (const density of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
    for (const icon of ['ic_launcher.png', 'ic_launcher_alt.png']) {
      assert.ok(fs.existsSync(path.join(root, `android/app/src/main/res/mipmap-${density}/${icon}`)), `${density}/${icon}`);
    }
  }
});

test('GitHub Pages workflow publishes the downloads page as the site root', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/pages.yml'), 'utf8');
  assert.match(workflow, /branches: \[main\]/);
  assert.match(workflow, /cp frontend\/download\.html public\/index\.html/);
  assert.match(workflow, /actions\/upload-pages-artifact@v3/);
  assert.match(workflow, /actions\/deploy-pages@v4/);
});

test('HTML diagnostics run on demand and offer reviewed repair prompts', () => {
  const tests = fs.readFileSync(path.join(root, 'frontend/scripts/html-tests.js'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'frontend/scripts/app.js'), 'utf8');
  assert.match(tests, /window\.jarvesHtmlTestReport = report/);
  assert.doesNotMatch(tests, /if \(document\.getElementById\('htmlTestResults'\)\) run\(\)/);
  assert.match(app, /failedTests = report\?\.checks\?\.filter/);
  assert.match(app, /input\.focus\(\)/);
  assert.match(app, /repairFile\.files\?\.\[0\]/);
  assert.match(app, /512 \* 1024/);
});

test('docs exist', () => {
  for (const f of ['README.md','SECURITY.md','.env.example']) {
    assert.ok(fs.existsSync(path.join(root, f)), f);
  }
});
