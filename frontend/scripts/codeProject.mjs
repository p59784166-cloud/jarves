const LANGUAGE_EXTENSIONS = Object.freeze({
  html: ['.html', '.htm'],
  css: ['.css'],
  javascript: ['.js', '.mjs', '.cjs'],
  typescript: ['.ts'],
  python: ['.py'],
  java: ['.java'],
  c: ['.c', '.h'],
  cpp: ['.cpp', '.cc', '.cxx', '.hpp', '.h'],
  php: ['.php'],
  json: ['.json'],
  xml: ['.xml'],
  gdscript: ['.gd'],
  shell: ['.sh'],
});

const MIME_TYPES = Object.freeze({
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.cjs': 'text/javascript',
  '.ts': 'text/plain',
  '.py': 'text/x-python',
  '.java': 'text/x-java',
  '.c': 'text/x-c',
  '.h': 'text/plain',
  '.cpp': 'text/x-c++',
  '.cc': 'text/x-c++',
  '.cxx': 'text/x-c++',
  '.hpp': 'text/plain',
  '.php': 'application/x-httpd-php',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.gd': 'text/plain',
  '.sh': 'text/x-shellscript',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.toml': 'text/plain',
  '.yml': 'text/yaml',
  '.yaml': 'text/yaml',
  '.gradle': 'text/plain',
  '.properties': 'text/plain',
});
const PROJECT_TEXT_EXTENSIONS = new Set(['.md', '.html', '.htm', '.css', '.json', '.txt', '.toml', '.yml', '.yaml', '.xml', '.gradle', '.properties', '.sh']);

export function parseGeneratedCodeProject(rawResponse, language) {
  const allowedExtensions = LANGUAGE_EXTENSIONS[language];
  if (!allowedExtensions) throw new Error('Linguagem de programação não suportada.');
  if (typeof rawResponse !== 'string' || rawResponse.length > 300_000) {
    throw new Error('A resposta do modelo está vazia ou excede o limite de 300 KB.');
  }
  const json = rawResponse.replace(/^\s*```(?:json)?\s*|\s*```\s*$/gi, '').trim();
  let project;
  try {
    project = JSON.parse(json);
  } catch {
    throw new Error('O modelo não retornou o manifesto JSON esperado; tente novamente ou use outro modelo.');
  }
  if (!project || !Array.isArray(project.files) || project.files.length < 1 || project.files.length > 20) {
    throw new Error('O projeto precisa conter de 1 a 20 arquivos de texto.');
  }

  let totalSize = 0;
  const names = new Set();
  const files = project.files.map(file => {
    if (!file || typeof file.name !== 'string' || typeof file.content !== 'string') {
      throw new Error('Cada arquivo precisa ter nome e conteúdo em texto.');
    }
    if (file.encoding !== undefined) throw new Error('Arquivos gerados devem conter texto UTF-8, não conteúdo codificado ou binário.');
    const name = file.name.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(name) || name === '.' || name === '..') {
      throw new Error(`Nome de arquivo inválido: ${name || '(vazio)'}.`);
    }
    const key = name.toLowerCase();
    if (names.has(key)) throw new Error(`Nome de arquivo duplicado: ${name}.`);
    names.add(key);
    if (!file.content.trim() || file.content.length > 100_000) {
      throw new Error(`O arquivo ${name} está vazio ou excede 100 KB.`);
    }
    totalSize += file.content.length;
    if (totalSize > 250_000) throw new Error('O projeto excede o limite total de 250 KB.');
    const extension = name.slice(name.lastIndexOf('.')).toLowerCase();
    if (!allowedExtensions.includes(extension) && !PROJECT_TEXT_EXTENSIONS.has(extension)) {
      throw new Error(`O arquivo ${name} não corresponde à linguagem ${language}.`);
    }
    return { name, content: file.content, mime: MIME_TYPES[extension] || 'text/plain' };
  });
  if (!files.some(file => allowedExtensions.includes(file.name.slice(file.name.lastIndexOf('.')).toLowerCase()))) {
    throw new Error(`Inclua pelo menos um arquivo-fonte da linguagem ${language}.`);
  }

  const plan = Array.isArray(project.plan)
    ? project.plan.filter(step => typeof step === 'string' && step.trim()).slice(0, 10).map(step => step.trim().slice(0, 200))
    : [];
  return { type: 'codigo', language, plan, files };
}

export { LANGUAGE_EXTENSIONS };
