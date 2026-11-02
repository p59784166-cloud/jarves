import dns from 'node:dns/promises';
import { isIP } from 'node:net';
import http from 'node:http';
import https from 'node:https';

const MAX_REDIRECTS = 4;
const REQUEST_TIMEOUT_MS = 30_000;

const blockedIpv4 = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];
const blockedIpv6 = [
  ['::', 96], ['::ffff:0:0', 96], ['64:ff9b::', 96], ['64:ff9b:1::', 48],
  ['100::', 64], ['2001::', 23], ['2001:db8::', 32], ['2002::', 16],
  ['3fff::', 20], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
].map(([address, prefix]) => [ipv6ToBigInt(address), prefix]);

function ipv6ToBigInt(address) {
  let value = address.toLowerCase();
  if (value.includes('.')) {
    const lastColon = value.lastIndexOf(':');
    const octets = value.slice(lastColon + 1).split('.').map(Number);
    if (octets.length !== 4 || octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null;
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    value = `${value.slice(0, lastColon)}:${high}:${low}`;
  }
  const halves = value.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const parts = halves.length === 2
    ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right]
    : left;
  if (parts.length !== 8 || parts.some(part => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  return parts.reduce((result, part) => (result << 16n) | BigInt(`0x${part}`), 0n);
}

function ipv4ToBigInt(address) {
  return address.split('.').reduce((result, part) => (result << 8n) | BigInt(Number(part)), 0n);
}

function inRange(value, base, prefix, bits) {
  const shift = BigInt(bits - prefix);
  return (value >> shift) === (base >> shift);
}

export function isPublicAddress(address, family = isIP(address)) {
  if (family !== 4 && family !== 6) return false;
  if (family === 4) {
    const value = ipv4ToBigInt(address);
    return !blockedIpv4.some(([base, prefix]) => inRange(value, ipv4ToBigInt(base), prefix, 32));
  }
  const value = ipv6ToBigInt(address);
  return value !== null && !blockedIpv6.some(([base, prefix]) => inRange(value, base, prefix, 128));
}

function parseDownloadUrl(value) {
  let url;
  try { url = new URL(String(value)); }
  catch { throw Object.assign(new Error('Informe uma URL válida de arquivo.'), { status: 400 }); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw Object.assign(new Error('Use uma URL HTTP ou HTTPS pública, sem usuário ou senha.'), { status: 400 });
  }
  url.hash = '';
  return url;
}

async function resolvePublicAddress(host) {
  const family = isIP(host);
  if (family) {
    if (!isPublicAddress(host, family)) {
      throw Object.assign(new Error('Por segurança, só é possível baixar de endereços públicos.'), { status: 400 });
    }
    return { address: host, family };
  }

  let addresses;
  try { addresses = await dns.lookup(host, { all: true, verbatim: true }); }
  catch { throw Object.assign(new Error('Não foi possível localizar o endereço público informado.'), { status: 400 }); }
  if (!addresses.length || addresses.some(item => !isPublicAddress(item.address, item.family))) {
    throw Object.assign(new Error('O domínio precisa resolver somente para endereços públicos.'), { status: 400 });
  }
  return addresses[0];
}

function safeFilename(value) {
  let name = String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/[\\/]/g, '_').trim();
  if (name === '.' || name === '..') name = '';
  return (name || 'download').slice(0, 240);
}

function filenameFromResponse(url, header) {
  const extended = header?.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1];
  if (extended) {
    try { return safeFilename(decodeURIComponent(extended.trim().replace(/^"|"$/g, ''))); }
    catch { /* Use the regular filename or URL path if the header is malformed. */ }
  }
  const regular = header?.match(/filename\s*=\s*(?:"([^"]*)"|([^;]*))/i);
  if (regular) return safeFilename(regular[1] || regular[2]);
  let pathName = url.pathname.split('/').filter(Boolean).at(-1) || 'download';
  try { pathName = decodeURIComponent(pathName); } catch { /* Keep the encoded path component. */ }
  return safeFilename(pathName);
}

function requestOnce(url, address) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const req = transport.request({
      protocol: url.protocol,
      hostname: host,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: { Accept: '*/*', 'Accept-Encoding': 'identity', 'User-Agent': 'JARVES file downloader' },
      servername: isIP(host) ? undefined : host,
      family: address.family,
      lookup: (_hostname, options, callback) => {
        if (options?.all) callback(null, [address]);
        else callback(null, address.address, address.family);
      },
    }, response => resolve(response));

    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(Object.assign(new Error('Tempo limite sem receber dados do servidor.'), { status: 504 })));
    req.once('error', reject);
    req.end();
  });
}

async function responseFor(url, redirects = 0) {
  const address = await resolvePublicAddress(url.hostname.replace(/^\[|\]$/g, ''));
  const response = await requestOnce(url, address);
  if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
    const location = response.headers.location;
    response.destroy();
    if (!location || redirects >= MAX_REDIRECTS) {
      throw Object.assign(new Error('O servidor excedeu o limite de redirecionamentos.'), { status: 502 });
    }
    return responseFor(parseDownloadUrl(new URL(location, url)), redirects + 1);
  }
  if (response.statusCode !== 200) {
    response.destroy();
    throw Object.assign(new Error(`O servidor remoto respondeu HTTP ${response.statusCode || 'inválido'}.`), { status: 502 });
  }
  return { response, url };
}

export async function openPublicFile(value) {
  const url = parseDownloadUrl(value);
  const { response, url: finalUrl } = await responseFor(url);
  const contentType = String(response.headers['content-type'] || 'application/octet-stream')
    .split(';', 1)[0].trim().toLowerCase();
  const mime = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(contentType)
    ? contentType
    : 'application/octet-stream';
  return {
    name: filenameFromResponse(finalUrl, response.headers['content-disposition']),
    mime,
    contentLength: Number(response.headers['content-length']) || null,
    stream: response,
  };
}
