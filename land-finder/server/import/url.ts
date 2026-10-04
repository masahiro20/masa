// 物件ページのURLから物件情報を取り込む（担当者が1件ずつ指定する用途を想定）。
// 表（th/td・dt/dd）の「項目名：値」を汎用的に読み取るため、特定サイト専用のセレクタに依存しない。
// 取り込み前に robots.txt を確認し、クロールが禁止されているパスは取得しない。
import { fetchWithTimeout, USER_AGENT } from '../http';
import { buildListing, toFieldMap, type BuildResult } from './fields';

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITY[e.toLowerCase()] ?? m;
  });
}

const stripTags = (html: string) =>
  decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();

/** HTMLから「項目名 → 値」の組を抜き出す */
export function extractPairs(html: string): [string, string][] {
  const body = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  const pairs: [string, string][] = [];
  for (const m of body.matchAll(/<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/gi)) {
    pairs.push([stripTags(m[1]), stripTags(m[2])]);
  }
  for (const m of body.matchAll(/<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi)) {
    pairs.push([stripTags(m[1]), stripTags(m[2])]);
  }
  return pairs.filter(([k, v]) => k && v && k.length <= 30);
}

export function extractTitle(html: string): string | undefined {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  const t = og?.[1] ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return t ? decodeEntities(t).replace(/\s+/g, ' ').trim() : undefined;
}

/** robots.txt の User-agent: * に対する Disallow を簡易判定する */
export function isAllowedByRobots(robots: string, pathname: string): boolean {
  let applies = false;
  const disallow: string[] = [];
  const allow: string[] = [];
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const [k, ...rest] = line.split(':');
    const v = rest.join(':').trim();
    if (/^user-agent$/i.test(k)) applies = v === '*';
    else if (applies && /^disallow$/i.test(k) && v) disallow.push(v);
    else if (applies && /^allow$/i.test(k) && v) allow.push(v);
  }
  const matches = (rule: string) => {
    const re = new RegExp('^' + rule.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
    return re.test(pathname);
  };
  const d = disallow.filter(matches).sort((a, b) => b.length - a.length)[0];
  const a = allow.filter(matches).sort((x, y) => y.length - x.length)[0];
  return !d || (a != null && a.length >= d.length);
}

export async function importFromUrl(url: string): Promise<BuildResult & { pairs: number }> {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol)) throw new Error('http(s) のURLを指定してください');

  const robotsRes = await fetchWithTimeout(`${u.origin}/robots.txt`, { headers: { 'User-Agent': USER_AGENT } }, 8_000).catch(() => null);
  if (robotsRes?.ok && !isAllowedByRobots(await robotsRes.text(), u.pathname + u.search)) {
    throw new Error('このページは robots.txt で自動取得が禁止されています。内容を手入力またはCSVで取り込んでください。');
  }

  const res = await fetchWithTimeout(url, { headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'ja' } }, 15_000);
  if (!res.ok) throw new Error(`ページを取得できませんでした（HTTP ${res.status}）。サイト側でアクセスが制限されている可能性があります。`);
  const html = await res.text();
  const pairs = extractPairs(html);
  const fields = toFieldMap(pairs);
  fields.url = url;
  fields.title ??= extractTitle(html);
  const result = buildListing(fields, { id: 'url', label: u.hostname.replace(/^www\./, '') }, url);
  return { ...result, pairs: pairs.length };
}
