// テスト用：一時フォルダでサーバーを立ち上げ、APIを呼ぶ
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../lib/app.js';
import { Store } from '../lib/store.js';
import { defaultSettings } from '../lib/seed.js';
import { sampleMenu } from './fixtures/sample-menu.js';

export async function startApp({ now = () => new Date('2026-10-19T03:00:00Z'), settings = {}, ...opts } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cafe-test-'));
  const s = { ...defaultSettings(), tagCount: 20, paymentMethods: ['現金', 'クレジットカード', 'QR決済'], ...settings };
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ settings: s, ...sampleMenu(), tags: [], openChecks: [] }));
  const app = createApp({ store: new Store(dir), now, ...opts });
  const server = http.createServer((req, res) => app.handle(req, res));
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';

  async function api(method, p, body, { raw = false, headers = {} } = {}) {
    const res = await fetch(base + p, {
      method, headers: { 'Content-Type': raw ? 'application/x-www-form-urlencoded' : 'application/json', Cookie: cookie, ...headers },
      body: body == null ? undefined : raw ? body : JSON.stringify(body),
    });
    const sc = res.headers.get('set-cookie');
    if (sc && sc.startsWith('cafe_admin=')) cookie = sc.split(';')[0];
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, data: ct.includes('json') ? await res.json() : await res.text() };
  }
  await api('POST', '/api/admin/login', { pin: '1234' });
  const state = async () => (await api('GET', '/api/admin/state')).data;

  // 札の番号で伝票を作って注文まで入れる
  async function openWithOrder(tagNo, lines) {
    const c = (await api('POST', '/api/admin/checks', { tagNo, people: 2 })).data.check;
    const r = await api('POST', `/api/admin/checks/${c.id}/orders`, { lines });
    return r.data.check;
  }

  return {
    app, api, state, openWithOrder, base,
    close() { server.close(); app.store.saveNow(); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}
