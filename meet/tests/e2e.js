// ブラウザ（Chromium）で、実際の操作どおりに通話をつなぐ確認。
//   node tests/e2e.js [スクリーンショットの保存先]
// 偽のカメラ・マイク（Chromium の試験用映像）を使う。
// E2E_MODE=vercel なら Vercel の入り口（api/handler.js）を通して確かめる。
'use strict';
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const sec = require('../lib/secure');

const PASSWORD = 'e2e-pass-123';
const env = {
  STAFF_ACCOUNTS: JSON.stringify([{ id: 'nakatani', name: '中谷 真弘', role: 'staff', hash: sec.hashPassword(PASSWORD) }]),
  INSECURE_COOKIE: '1',
};
Object.assign(process.env, env);
const { start } = process.env.E2E_MODE === 'vercel' ? require('./vercel-sim.js') : require('../server.js');
const { createMemoryStore } = require('../lib/store');

const shots = process.argv[2];
const step = (s) => console.log(`✓ ${s}`);
const shot = async (page, name) => { if (shots) await page.screenshot({ path: path.join(shots, name) }); };

(async () => {
  const server = await start(0, { store: createMemoryStore(), env: { ...process.env, ...env } });
  const base = `http://localhost:${server.address().port}`;
  console.log(`（${process.env.E2E_MODE === 'vercel' ? 'Vercel の入り口' : '手元のサーバー'}で確認）`);
  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--auto-select-desktop-capture-source=Entire screen', '--auto-accept-this-tab-capture'],
  });
  const ctx = (vp) => browser.newContext({ permissions: ['camera', 'microphone', 'clipboard-read', 'clipboard-write'], viewport: vp || { width: 1280, height: 780 }, deviceScaleFactor: shots ? 2 : 1 });
  const errors = [];
  const watch = (who, p) => {
    p.on('pageerror', (e) => errors.push(`${who}: ${e.message}`));
    p.on('response', (r) => { if (r.status() === 429) console.log(`  429 ${who} ${r.request().method()} ${new URL(r.url()).pathname}`); });
    p.on('console', (m) => {
      if (m.type() !== 'error') return;
      const url = (m.location() || {}).url || '';
      if (/fonts\.(googleapis|gstatic)\.com/.test(url)) return; // 試験環境から Google Fonts に出られないため
      if (/Failed to load resource: the server responded with a status of (401|403|404|409|410)/.test(m.text())) return; // 想定どおりの拒否
      errors.push(`${who}: ${m.text()}`);
    });
    return p;
  };
  const host = watch('担当', await (await ctx()).newPage());
  const guest = watch('お客様', await (await ctx({ width: 900, height: 700 })).newPage());

  // 1) 社員ログイン → 打ち合わせのリンクを作る
  await host.goto(base);
  await host.fill('#loginId', 'nakatani');
  await host.fill('#loginPw', PASSWORD);
  await host.click('#loginForm button[type=submit]');
  await host.waitForSelector('#createBox:not(.hidden)');
  await host.fill('#title', '間取りのご相談（2 回目）');
  await host.fill('#customerName', '山田 太郎');
  await host.click('#create');
  await host.waitForSelector('#result:not(.hidden)');
  const url = await host.textContent('#url');
  assert.match(url, /\/r\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/);
  const gcal = decodeURIComponent(await host.getAttribute('#gcal', 'href'));
  assert.ok(gcal.includes(url) && !gcal.includes('山田'), 'お客様向けの予定にはお客様名を入れない');
  await host.waitForSelector('.mrow');
  await shot(host, '01-home.png');
  step('社員ログインと打ち合わせの作成');

  // 2) お客様が先に開く → 件名・お客様名は見えない → 参加しても待合室
  await guest.goto(url);
  await guest.waitForSelector('#lobby:not(.hidden)');
  const lobbyText = await guest.textContent('#lobby');
  assert.ok(!lobbyText.includes('山田 太郎') && !lobbyText.includes('間取り'), '入室前の画面に件名・お客様名が出ている');
  assert.ok(lobbyText.includes('担当：中谷 真弘'));
  await guest.fill('#name', '山田 太郎');
  await guest.waitForFunction(() => document.querySelector('#preview').videoWidth > 0);
  await shot(guest, '02-guest-lobby.png');
  await guest.click('#joinBtn');
  await guest.waitForSelector('#waitBox:not(.hidden)');
  await guest.waitForFunction(() => document.querySelector('#waitText').textContent.includes('まだ入室していません'));
  assert.ok(await guest.isHidden('#call'));
  step('お客様は最初に来ても主催者にならず、待合室で待つ');

  // 3) 担当者が入室 → 待っている人の一覧 → 許可
  await host.click('#open');
  await host.waitForSelector('#lobby:not(.hidden)');
  assert.ok(await host.isVisible('#hostNote'));
  assert.equal(await host.inputValue('#name'), '中谷 真弘');
  await host.click('#joinBtn');
  await host.waitForSelector('#call:not(.hidden)');
  await host.click('#peopleBtn');
  await host.waitForSelector('.knock >> text=山田 太郎');
  await shot(host, '03-host-knock.png');
  await host.click('.knock button:has-text("許可")');
  await guest.waitForSelector('#call:not(.hidden)');
  const remoteVideoCount = (p, n) => p.waitForFunction((k) => [...document.querySelectorAll('.tile:not(.self) video')].filter((v) => v.videoWidth > 0 && v.readyState >= 2).length >= k, n, { timeout: 20000 });
  await remoteVideoCount(host, 1);
  await remoteVideoCount(guest, 1);
  assert.equal(await guest.textContent('#cTitle'), '間取りのご相談（2 回目）', '件名は入室後にだけ見える');
  assert.equal(await guest.isVisible('#notesBtn'), false, 'お客様にはメモのボタンが出ない');
  step('担当者の許可で入室し、映像・音声が双方向につながる');

  // 4) 3 人目（ご家族）も入室
  const guest2 = watch('ご家族', await (await ctx({ width: 1100, height: 720 })).newPage());
  await guest2.goto(url);
  await guest2.fill('#name', '山田 花子');
  await guest2.click('#joinBtn');
  await host.waitForSelector('.knock >> text=山田 花子');
  await host.click('.knock button:has-text("許可")');
  await remoteVideoCount(guest2, 2);
  await remoteVideoCount(host, 2);
  await remoteVideoCount(guest, 2);
  step('3 人で通話できる（途中参加）');

  // 5) 担当者が画面共有 → お客様が書き込み → 担当者側に同じ位置で出る
  await host.click('#screen');
  await guest.waitForFunction(() => !document.querySelector('#annBtn').classList.contains('hidden'), null, { timeout: 15000 });
  await guest.waitForFunction(() => { const v = document.querySelector('.tile.featured video'); return v && v.videoWidth > 0; });
  await guest.click('#annBtn');
  await guest.waitForSelector('#toolbar:not(.hidden)');
  const box = await guest.evaluate(() => { const r = window.__meet.annRect(); const c = document.querySelector('#annCanvas').getBoundingClientRect(); return { x: r.x + c.left, y: r.y + c.top, w: r.w, h: r.h }; });
  const P = (nx, ny) => [box.x + nx * box.w, box.y + ny * box.h];
  await guest.mouse.move(...P(0.3, 0.4));
  await guest.mouse.down();
  for (let i = 1; i <= 12; i++) await guest.mouse.move(...P(0.3 + i * 0.02, 0.4 + Math.sin(i / 2) * 0.05));
  await guest.mouse.up();
  const guestShape = await guest.evaluate(() => window.__meet.annBoard.shapes[0]);
  await host.waitForFunction((n) => window.__meet.annBoard.shapes.length === 1 && window.__meet.annBoard.shapes[0].pts.length === n, guestShape.pts.length, { timeout: 10000 });
  const hostShape = await host.evaluate(() => window.__meet.annBoard.shapes[0]);
  assert.equal(hostShape.by, guestShape.by);
  assert.equal(hostShape.name, '山田 太郎', '書いた人が分かる');
  assert.ok(Math.abs(hostShape.pts[0][0] - 0.3) < 0.01 && Math.abs(hostShape.pts[0][1] - 0.4) < 0.01, `位置がずれている: ${hostShape.pts[0]}`);
  assert.deepEqual(hostShape.pts.length, guestShape.pts.length);
  // 画面の大きさが違っても、映像の中の同じ場所になる（担当者側の表示座標に戻して確かめる）
  const hostPx = await host.evaluate(() => { const r = window.__meet.annRect(); const s = window.__meet.annBoard.shapes[0].pts[0]; return { inside: s[0] >= 0 && s[0] <= 1 && s[1] >= 0 && s[1] <= 1, rw: r.w, rh: r.h }; });
  assert.ok(hostPx.inside);
  assert.ok(Math.abs(hostPx.rw / hostPx.rh - box.w / box.h) < 0.02, '担当者とお客様で、映像の縦横比が同じ枠に書き込みが合わせられている');
  await guest2.waitForFunction(() => window.__meet.annBoard.shapes.length === 1, null, { timeout: 10000 });
  await guest.waitForTimeout(300);
  await shot(host, '04-annotation-host.png');
  // 書き込みの権限を切ると、お客様の書き込みは無視される
  const openPeople = (p) => p.evaluate(() => { if (document.querySelector('#side').classList.contains('hidden')) document.querySelector('#peopleBtn').click(); else document.querySelector('.tab[data-tab="people"]').click(); });
  await openPeople(host);
  await host.click('label.switch:has-text("画面共有への書き込み")');
  await guest.waitForFunction(() => !window.__meet.room().perms.guestAnnotate);
  assert.equal(await guest.evaluate(() => document.querySelector('#annBtn').classList.contains('on')), false);
  await host.click('label.switch:has-text("画面共有への書き込み")');
  await host.click('#screen'); // 共有を止める
  await guest.waitForFunction(() => document.querySelector('#annBtn').classList.contains('hidden'));
  step('画面共有にお客様が書き込み、担当者・ご家族の画面の同じ位置に出る（画面の大きさが違っても）');

  // 6) ホワイトボード：担当者が開いて「全員に表示」→ お客様が四角を描く → 後から入った人にも届く
  await host.click('#wbBtn');
  await host.click('#tShow');
  await guest.waitForSelector('#wb:not(.hidden)', { timeout: 10000 });
  await guest.click('#tools .tbtn[data-tool="rect"]');
  const wb = await guest.evaluate(() => { const r = window.__meet.wbRect(); const c = document.querySelector('#wbCanvas').getBoundingClientRect(); return { x: r.x + c.left, y: r.y + c.top, w: r.w, h: r.h }; });
  await guest.mouse.move(wb.x + wb.w * 0.2, wb.y + wb.h * 0.2);
  await guest.mouse.down();
  await guest.mouse.move(wb.x + wb.w * 0.5, wb.y + wb.h * 0.5, { steps: 5 });
  await guest.mouse.up();
  await host.waitForFunction(() => window.__meet.wbBoard.shapes.some((s) => s.t === 'rect'), null, { timeout: 10000 });
  const rect = await host.evaluate(() => window.__meet.wbBoard.shapes.find((s) => s.t === 'rect'));
  assert.ok(Math.abs(rect.a[0] - 0.2) < 0.01 && Math.abs(rect.b[1] - 0.5) < 0.01);
  await host.click('#tools .tbtn[data-tool="pen"]');
  const hwb = await host.evaluate(() => { const r = window.__meet.wbRect(); const c = document.querySelector('#wbCanvas').getBoundingClientRect(); return { x: r.x + c.left, y: r.y + c.top, w: r.w, h: r.h }; });
  await host.mouse.move(hwb.x + hwb.w * 0.6, hwb.y + hwb.h * 0.6);
  await host.mouse.down();
  await host.mouse.move(hwb.x + hwb.w * 0.8, hwb.y + hwb.h * 0.7, { steps: 8 });
  await host.mouse.up();
  await guest2.waitForFunction(() => window.__meet.wbBoard.shapes.length >= 2, null, { timeout: 10000 });
  await host.waitForTimeout(300);
  await shot(host, '05-whiteboard.png');
  await host.click('#wbBtn');
  step('ホワイトボードを全員で同時に編集できる');

  // 7) チャット（URL はリンクになる）・未読の印
  await guest.click('#chatBtn');
  await guest.fill('#chatInput', '参考の写真です https://example.com/kitchen');
  await guest.press('#chatInput', 'Enter');
  await host.waitForSelector('#chatBtn .badge');
  await host.click('#chatBtn');
  const href = await host.getAttribute('.msg .text a', 'href');
  assert.equal(href, 'https://example.com/kitchen');
  assert.equal(await host.getAttribute('.msg .text a', 'rel'), 'noopener noreferrer');
  await guest.fill('#chatInput', '<img src=x onerror=alert(1)>');
  await guest.press('#chatInput', 'Enter');
  await host.waitForFunction(() => [...document.querySelectorAll('.msg .text')].some((t) => t.textContent.includes('<img')));
  assert.equal(await host.evaluate(() => document.querySelectorAll('.msg .text img').length), 0, 'チャットの文字が HTML として解釈されている');
  step('チャット（URL のリンク化、HTML の埋め込みは無効）');

  // 8) 担当者のメモ → 自動保存 → 記録で見られる
  await host.click('#notesBtn');
  await host.fill('#nBody', 'LDK は 20 帖ほど。吹き抜けを希望');
  await host.fill('#nDecisions', '平屋で進める');
  await host.waitForFunction(() => document.querySelector('#notesStatus').textContent.includes('保存しました'), null, { timeout: 8000 });
  const rec = await host.evaluate(async (id) => (await (await fetch(`/api/meetings/${id}`)).json()).meeting.notes, url.split('/').pop());
  assert.equal(rec.decisions, '平屋で進める');
  await shot(host, '06-notes.png');
  step('担当者のメモが自動で保存される');

  // 9) ページを開き直したお客様が、そのまま戻ってこられる（再接続）
  await guest.reload();
  await guest.waitForSelector('#call:not(.hidden)', { timeout: 15000 });
  await remoteVideoCount(guest, 2);
  await host.waitForFunction(() => [...document.querySelectorAll('.tile:not(.self) video')].filter((v) => v.videoWidth > 0).length >= 2, null, { timeout: 20000 });
  step('ページを開き直しても、通話に戻れる（つなぎ直し）');

  // 10) 全員ミュート → 強制退出
  await openPeople(host);
  await host.click('button:has-text("全員のマイクをオフ")');
  await guest.waitForFunction(() => document.querySelector('#mic').classList.contains('off'));
  const g2id = await guest2.evaluate(() => window.__meet.me.peerId);
  await host.click(`button[data-kick="${g2id}"]`);
  await host.click('#modalActions button:has-text("退出させる")');
  await guest2.waitForSelector('#fatal:not(.hidden) >> text=退出しました');
  await host.waitForFunction(() => document.querySelectorAll('.tile:not(.self)').length === 1);
  step('全員のマイクをオフ・強制退出');

  // 11) 主催者が全員の通話を終了 → 再入室できない
  await host.click('#endAll');
  await host.click('#modalActions button:has-text("全員の通話を終了")');
  await guest.waitForSelector('#fatal:not(.hidden) >> text=打ち合わせは終了しました', { timeout: 10000 });
  await shot(guest, '07-ended.png');
  await guest.goto(url);
  await guest.waitForSelector('#fatal:not(.hidden) >> text=終了しました');
  step('主催者が通話を終了すると、全員が退出し、再入室できない');

  // 12) 打ち合わせ記録
  await host.goto(`${base}/records#${url.split('/').pop()}`);
  await host.waitForSelector('.rec-head h2');
  assert.ok(await host.evaluate(() => [...document.querySelectorAll('#detail textarea')].some((t) => t.value === '平屋で進める')));
  assert.match(await host.textContent('#detail'), /山田 花子/);
  await shot(host, '08-records.png');
  step('打ち合わせ記録でメモ・参加者を見返せる');

  // スマートフォン幅の見た目
  if (shots) {
    const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ['camera', 'microphone'] })).newPage();
    await phone.goto(base);
    await phone.screenshot({ path: path.join(shots, '09-phone-home.png'), fullPage: false });
  }

  assert.deepEqual(errors, [], 'ブラウザでエラーが出ていない');
  await browser.close();
  server.closeAllConnections && server.closeAllConnections();
  server.close();
  console.log('すべて OK');
})().catch((e) => { console.error(e); process.exit(1); });
