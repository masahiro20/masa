#!/usr/bin/env node
// 本番に入れる設定値を作る道具（作るだけ。どこにも送らない・保存しない）
//
//   node scripts/setup.js keys
//     → DATA_KEY（保存データの暗号化）と SESSION_SECRET（ログインの署名）を作る
//   node scripts/setup.js staff <社員ID> <表示名> [admin]
//     → パスワードを聞いて、STAFF_ACCOUNTS に入れる 1 件分（scrypt ハッシュ）を表示する
//
// 出てきた値は Vercel の環境変数（Sensitive）に入れる。チャットやメールには貼らない。
'use strict';
const crypto = require('node:crypto');
const readline = require('node:readline');
const { hashPassword } = require('../lib/secure');

const [cmd, ...args] = process.argv.slice(2);

function askHidden(q) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(q)) process.stdout.write(s); };
    rl.question(q, (a) => { rl.close(); process.stdout.write('\n'); resolve(a); });
  });
}

(async () => {
  if (cmd === 'keys') {
    console.log(`DATA_KEY=${crypto.randomBytes(32).toString('base64url')}`);
    console.log(`SESSION_SECRET=${crypto.randomBytes(32).toString('base64url')}`);
    console.log(`MEET_API_KEY=${crypto.randomBytes(24).toString('base64url')}`);
    console.log('\n※ DATA_KEY を変えると、保存済みの記録は読めなくなります。安全な場所に控えてください。');
    return;
  }
  if (cmd === 'staff') {
    const [id, name, role] = args;
    if (!id || !/^[\w.@-]{1,64}$/.test(id) || !name) { console.error('使い方: node scripts/setup.js staff <社員ID> <表示名> [admin]'); process.exit(1); }
    const pw = await askHidden('パスワード（12 文字以上）: ');
    if (pw.length < 12) { console.error('12 文字以上にしてください'); process.exit(1); }
    const pw2 = await askHidden('もう一度: ');
    if (pw !== pw2) { console.error('一致しません'); process.exit(1); }
    console.log(JSON.stringify({ id, name, role: role === 'admin' ? 'admin' : 'staff', hash: hashPassword(pw) }));
    console.log('\n↑ この 1 行を STAFF_ACCOUNTS の配列 [ ... ] に加えてください。');
    return;
  }
  console.log('使い方:\n  node scripts/setup.js keys\n  node scripts/setup.js staff <社員ID> <表示名> [admin]');
})();
