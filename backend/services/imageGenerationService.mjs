import { isIP } from 'node:net';
import { getSetting } from '../../database/repositories/settingsRepository.mjs';

export const DEFAULT_IMAGE_GENERATOR_URL = 'http://127.0.0.1:7860';

const MAX_RESPONSE_BYTES = 24 * 1024 * 1024;
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
let generationInProgress = false;

function isPrivateAddress(host) {
  if (host === 'localhost') return true;
  const family = isIP(host);
  if (family === 4) {
    const [a, b] = host.split('.').map(Number);
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (family === 6) {
    const normalized = host.toLowerCase();
    return normalized === '::1' || /^f[cd]/.test(normalized) || /^fe[89ab]/.test(normalized);
  }
  return false;
}

export function validateImageGeneratorUrl(value) {
  let url;
  try { url = new URL(String(value)); }
  catch { throw new Error('Endereço inválido. Use o endereço HTTP local do Automatic1111 ou Forge.'); }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (url.protocol !== 'http:' || !isPrivateAddress(host) || url.username || url.password
      || (url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) {
    throw new Error('Use HTTP sem caminho, usuário ou senha e um endereço local ou privado, por exemplo http://127.0.0.1:7860.');
  }
  return url.origin;
}

function imageGeneratorUrl() {
  return validateImageGeneratorUrl(getSetting('image_gen_url', DEFAULT_IMAGE_GENERATOR_URL));
}

async function requestJson(url, options = {}, timeoutMs = 15000) {
  let response;
  try {
    response = await fetch(url, {
      ...options,
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw Object.assign(new Error('O gerador local demorou demais para responder.'), { status: 504 });
    }
    throw Object.assign(new Error('Não foi possível conectar ao gerador local. Verifique se o Automatic1111/Forge está iniciado com a API habilitada.'), { status: 503 });
  }
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw Object.assign(new Error(`O gerador local respondeu HTTP ${response.status}${detail ? `: ${detail}` : ''}`), { status: 502 });
  }
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
    throw Object.assign(new Error('A resposta do gerador excedeu o limite de tamanho.'), { status: 502 });
  }
  if (!response.body) throw Object.assign(new Error('O gerador local retornou uma resposta vazia.'), { status: 502 });

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw Object.assign(new Error('A resposta do gerador excedeu o limite de tamanho.'), { status: 502 });
    }
    chunks.push(Buffer.from(value));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('O gerador local retornou JSON inválido.'), { status: 502 }); }
}

export async function getImageGeneratorStatus() {
  const url = imageGeneratorUrl();
  const options = await requestJson(`${url}/sdapi/v1/options`);
  return {
    available: true,
    provider: 'Automatic1111/Forge local',
    model: typeof options.sd_model_checkpoint === 'string' ? options.sd_model_checkpoint : '',
  };
}

export async function generateImage({ prompt, width = 768, height = 768, steps = 20 } = {}) {
  if (generationInProgress) throw Object.assign(new Error('Já existe uma geração de imagem em andamento.'), { status: 409 });
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 1200) {
    throw Object.assign(new Error('Descreva a imagem em até 1.200 caracteres.'), { status: 400 });
  }
  if (![512, 768, 1024].includes(width) || ![512, 768, 1024].includes(height)) {
    throw Object.assign(new Error('Escolha uma resolução suportada: 512, 768 ou 1024 pixels.'), { status: 400 });
  }
  if (!Number.isInteger(steps) || steps < 1 || steps > 30) {
    throw Object.assign(new Error('O número de etapas deve estar entre 1 e 30.'), { status: 400 });
  }

  const url = imageGeneratorUrl();
  generationInProgress = true;
  try {
    const status = await getImageGeneratorStatus();
    const result = await requestJson(`${url}/sdapi/v1/txt2img`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: prompt.trim(),
        negative_prompt: '',
        width,
        height,
        steps,
        cfg_scale: 7,
        batch_size: 1,
        n_iter: 1,
        save_images: false,
      }),
    }, 10 * 60 * 1000);
    const encoded = result.images?.[0];
    if (typeof encoded !== 'string') throw Object.assign(new Error('O gerador não retornou uma imagem.'), { status: 502 });
    const base64 = encoded.replace(/^data:image\/png;base64,/, '');
    if (!/^[\da-z+/]+={0,2}$/i.test(base64) || base64.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3)) {
      throw Object.assign(new Error('A imagem retornada é inválida ou excede o limite de 16 MB.'), { status: 502 });
    }
    const image = Buffer.from(base64, 'base64');
    if (image.length > MAX_IMAGE_BYTES || !image.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
      throw Object.assign(new Error('O gerador não retornou um PNG válido dentro do limite de 16 MB.'), { status: 502 });
    }
    return { image: image.toString('base64'), model: status.model };
  } finally {
    generationInProgress = false;
  }
}
