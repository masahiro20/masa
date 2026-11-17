// ブラウザ 2 台（担当者・お客様）で実際に通話をつなぐ確認。
//   node tests/e2e.js [スクリーンショットの保存先]
// 偽のカメラ・マイク（Chromium の試験用映像）を使う。
'use strict';
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

// E2E_MODE=vercel なら Vercel の入り口（api/handler.js）を通して確かめる
const { start } = process.env.E2E_MODE === 'vercel' ? require('./vercel-sim.js') : require('../server.js');

const shots = process.argv[2];

(async () => {
  const server = await start(0);
  console.log(`（${process.env.E2E_MODE === 'vercel' ? 'Vercel の入り口' : '手元のサーバー'}で確認）`);
  const base = `http://localhost:${server.address().port}`;
  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--auto-select-desktop-capture-source=Entire screen', '--auto-accept-this-tab-capture'],
  });
  const ctxOpts = { permissions: ['camera', 'microphone', 'clipboard-read', 'clipboard-write'], viewport: { width: 1280, height: 760 }, deviceScaleFactor: shots ? 2 : 1 };
  const host = await (await browser.newContext(ctxOpts)).newPage();
  const guest = await (await browser.newContext(ctxOpts)).newPage();
  const errors = [];
  for (const [who, p] of [['担当', host], ['お客様', guest]]) {
    p.on('pageerror', (e) => errors.push(`${who}: ${e.message}`));
    p.on('console', (m) => {
      if (m.type() !== 'error') return;
      // この試験環境からは Google Fonts に出られないので、文字の読み込み失敗だけは無視する
      if (/fonts\.(googleapis|gstatic)\.com/.test((m.location() || {}).url || '')) return;
      errors.push(`${who}: ${m.text()}`);
    });
  }

  // 1) はじめの画面で予定つきの通話リンクを作る
  await host.goto(base);
  await host.fill('#title', '山田様 間取り打ち合わせ');
  await host.click('#create');
  await host.waitForSelector('#result:not(.hidden)');
  const url = await host.textContent('#url');
  assert.match(url, /\/r\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/);
  const gcal = await host.getAttribute('#gcal', 'href');
  assert.match(gcal, /calendar\.google\.com/);
  assert.ok(decodeURIComponent(gcal).includes(url), 'Google カレンダーの予定に通話リンクが入る');
  if (shots) await host.screenshot({ path: path.join(shots, '1-home.png') });

  // 2) 担当者が入室（最初の人はそのまま入る）
  await host.goto(url);
  await host.waitForSelector('#lobby:not(.hidden)');
  await host.fill('#name', '中谷');
  await host.click('#joinBtn');
  await host.waitForSelector('#call:not(.hidden)');

  // 3) お客様が開く → 待機室
  await guest.goto(url);
  await guest.waitForSelector('#lobby:not(.hidden)');
  await guest.fill('#name', '山田 太郎');
  await guest.waitForFunction(() => document.querySelector('#preview').videoWidth > 0);
  if (shots) await guest.screenshot({ path: path.join(shots, '2-lobby.png') });
  await guest.click('#joinBtn');
  await guest.waitForSelector('#waitBox:not(.hidden)');
  assert.ok(await guest.isHidden('#call'), '許可されるまで通話に入れない');

  // 4) 担当者の画面に「参加を求めています」→ 許可
  await host.waitForSelector('#toast:not(.hidden) >> text=参加を求めています');
  if (shots) await host.screenshot({ path: path.join(shots, '3-knock.png') });
  await host.click('#toast button:has-text("許可")');
  await guest.waitForSelector('#call:not(.hidden)');

  // 5) お互いの映像が実際に届いている（相手のタイルの video に絵が来る）
  const remoteVideoOk = (p) => p.waitForFunction(() => {
    const v = document.querySelector('.tile:not(.self) video');
    return v && v.videoWidth > 0 && v.readyState >= 2;
  }, null, { timeout: 15000 });
  await remoteVideoOk(host);
  await remoteVideoOk(guest);
  const audioOk = await guest.evaluate(() => {
    const v = document.querySelector('.tile:not(.self) video');
    return v.srcObject.getAudioTracks().length === 1;
  });
  assert.ok(audioOk, '音声も届いている');
  console.log('✓ 映像・音声が双方向につながった');

  // 6) お客様がマイクを切る → 担当者側にマイク切の印
  await guest.click('#mic');
  await host.waitForFunction(() => document.querySelector('.tile:not(.self) .mic svg'));
  console.log('✓ マイクの入切が相手に伝わる');

  // 7) チャット
  await host.click('#chatBtn');
  await host.fill('#chatInput', '図面を画面共有しますね');
  await host.press('#chatInput', 'Enter');
  await guest.waitForSelector('#chatBtn .badge');
  await guest.click('#chatBtn');
  await guest.waitForSelector('.msg >> text=図面を画面共有しますね');
  console.log('✓ チャットが届く');

  // 8) 画面共有 → お客様側で大きく表示
  await host.click('#sideClose');
  await host.click('#screen');
  await guest.waitForFunction(() => document.querySelector('.tile.featured:not(.self)'), null, { timeout: 10000 });
  console.log('✓ 画面共有が相手側で大きく出る');
  if (shots) {
    await guest.waitForTimeout(800);
    await guest.screenshot({ path: path.join(shots, '4-call-guest.png') });
  }
  await host.click('#screen');
  await guest.waitForFunction(() => !document.querySelector('.tile.featured'), null, { timeout: 10000 });
  if (shots) {
    await host.waitForTimeout(500);
    await host.screenshot({ path: path.join(shots, '5-call-host.png') });
  }

  // 9) お客様が退出 → 担当者側からタイルが消える
  await guest.click('#leave');
  await host.waitForFunction(() => document.querySelectorAll('.tile').length === 1, null, { timeout: 10000 });
  console.log('✓ 退出が相手に伝わる');

  // スマートフォン幅の見た目
  if (shots) {
    const phone = await (await browser.newContext({ ...ctxOpts, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
    await phone.goto(url);
    await phone.waitForSelector('#lobby:not(.hidden)');
    await phone.fill('#name', '山田 花子');
    await phone.screenshot({ path: path.join(shots, '6-phone-lobby.png') });
  }

  const real = errors.filter((e) => !/favicon/.test(e));
  assert.deepEqual(real, [], 'ブラウザでエラーが出ていない');
  await browser.close();
  server.closeAllConnections();
  server.close();
  console.log('すべて OK');
})().catch((e) => { console.error(e); process.exit(1); });
