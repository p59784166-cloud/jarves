import { env } from '../config/env.mjs';
import { getSetting } from '../../database/repositories/settingsRepository.mjs';

export function isResearchEnabled() {
  const s = getSetting('research_enabled', null);
  if (s !== null && s !== '') return s === 'true' || s === '1';
  return env.RESEARCH_ENABLED === true;
}

export async function searchWeb(query, limit = 8) {
  if (!query || !query.trim()) throw new Error('Consulta vazia');
  if (!isResearchEnabled()) {
    // Antes este bloco era vazio: a pesquisa web externa funcionava mesmo desativada.
    const e = new Error('Pesquisa web desativada. Ative com RESEARCH_ENABLED=true no .env.');
    e.status = 403;
    throw e;
  }
  const q = encodeURIComponent(query.trim());
  // Try DuckDuckGo HTML
  const url = `https://html.duckduckgo.com/html/?q=${q}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (JARVES AI research)' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Pesquisa indisponivel: HTTP ${res.status}`);
  const html = await res.text();
  const results = parseDuck(html, limit);
  return { query, results, source: 'duckduckgo-html', disclaimer: 'Resultados obtidos por raspagem; verifique as fontes.' };
}

function parseDuck(html, limit) {
  const out = [];
  // result blocks
  const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) && out.length < limit) {
    const url = decodeDuckUrl(m[1]);
    const title = stripTags(m[2]);
    const snippet = stripTags(m[3]);
    if (title && url) out.push({ title, url, snippet });
  }
  // fallback simpler
  if (out.length === 0) {
    const re2 = /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([^<]{5,120})<\/a>/g;
    while ((m = re2.exec(html)) && out.length < limit) {
      const url = m[1];
      const title = stripTags(m[2]);
      if (title && !url.includes('duckduckgo.com')) out.push({ title, url, snippet: '' });
    }
  }
  return out;
}

function decodeDuckUrl(href) {
  try {
    const u = new URL(href, 'https://duckduckgo.com');
    const uddg = u.searchParams.get('uddg');
    return uddg ? decodeURIComponent(uddg) : href;
  } catch { return href; }
}

function stripTags(s) { return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(); }
