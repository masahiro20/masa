'use strict';
// 回数制限（固定の時間枠ごとに数える）
// 鍵は「何を」「誰が」で分ける。IP アドレスだけで縛ると、同じ家・会社の回線から来た正規のお客様まで
// 止めてしまうため、参加後の操作は参加者ごと、作成はスタッフごと、入室申し込みは「部屋ごと」と
// 「部屋×回線」の両方で数える。Redis には IP などをそのまま残さず、ハッシュにして使う。

const { sha256 } = require('./secure');

const RULES = {
  // 名前: [回数, 秒]
  login_fail_ip: [20, 900],      // 失敗だけを数える（社内の同じ回線から何人もログインしても止まらない）
  login_fail_account: [5, 900],
  create_staff: [30, 3600],
  create_global: [300, 86400],
  join_room: [30, 600],
  join_room_ip: [10, 600],
  pin_fail_room: [10, 900],
  info_ip: [120, 60],
  poll_peer: [240, 60],
  signal_peer: [900, 60],
  chat_peer: [30, 60],
  action_peer: [60, 60],
  host_action: [120, 60],
  api_ip: [600, 60],
};

function createLimiter(store) {
  async function hit(rule, ...keyParts) {
    const [limit, windowSec] = RULES[rule];
    const slot = Math.floor(Date.now() / 1000 / windowSec);
    const key = `rl:${rule}:${sha256(keyParts.join('|')).slice(0, 32)}:${slot}`;
    // 無ければ期限つきで作り、1 増やす（2 命令を 1 往復で）
    const [, count] = await store.pipeline([['SET', key, 0, 'EX', windowSec + 5, 'NX'], ['INCR', key]]);
    const retryAfter = (slot + 1) * windowSec - Math.floor(Date.now() / 1000);
    return { ok: count <= limit, count, limit, retryAfter };
  }
  // 数えずに、いまの回数だけを見る（失敗だけ数える使い方のため）
  async function peek(rule, ...keyParts) {
    const [limit, windowSec] = RULES[rule];
    const slot = Math.floor(Date.now() / 1000 / windowSec);
    const key = `rl:${rule}:${sha256(keyParts.join('|')).slice(0, 32)}:${slot}`;
    const [v] = await store.pipeline([['GET', key]]);
    const count = Number(v || 0);
    return { ok: count < limit, count, limit, retryAfter: (slot + 1) * windowSec - Math.floor(Date.now() / 1000) };
  }
  return { hit, peek, RULES };
}

module.exports = { createLimiter, RULES };
