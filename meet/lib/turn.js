'use strict';
// TURN（中継サーバー）の資格情報を、入室済みの参加者にだけ期限つきで渡す。
// 対応する方式：
//   coturn      … 自前の coturn（use-auth-secret）。TURN_URLS と TURN_SECRET を設定
//   cloudflare  … Cloudflare Realtime TURN。CF_TURN_KEY_ID と CF_TURN_API_TOKEN を設定
//   none        … 未設定（STUN だけ）
// どれも「勝手に契約しない」ため、既定は none。

const crypto = require('node:crypto');

const STUN = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

function createTurn(env, fetchImpl = fetch) {
  const ttl = Math.min(Number(env.TURN_TTL_SEC || 7200), 86400);
  const provider = env.TURN_PROVIDER || (env.TURN_SECRET ? 'coturn' : env.CF_TURN_KEY_ID ? 'cloudflare' : 'none');

  async function iceServersFor(peerId) {
    if (provider === 'coturn' && env.TURN_SECRET && env.TURN_URLS) {
      // coturn の TURN REST API 方式：username = 有効期限:利用者、credential = HMAC-SHA1(secret, username)
      const exp = Math.floor(Date.now() / 1000) + ttl;
      const username = `${exp}:${String(peerId).slice(0, 12)}`;
      const credential = crypto.createHmac('sha1', env.TURN_SECRET).update(username).digest('base64');
      return { iceServers: [...STUN, { urls: env.TURN_URLS.split(',').map((s) => s.trim()).filter(Boolean), username, credential }], ttl, provider };
    }
    if (provider === 'cloudflare' && env.CF_TURN_KEY_ID && env.CF_TURN_API_TOKEN) {
      const r = await fetchImpl(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.CF_TURN_KEY_ID)}/credentials/generate-ice-servers`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.CF_TURN_API_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl }),
      });
      if (!r.ok) throw new Error('TURN の資格情報を取得できませんでした');
      const j = await r.json();
      const cf = (Array.isArray(j.iceServers) ? j.iceServers : [j.iceServers]).filter(Boolean);
      return { iceServers: [...STUN, ...cf], ttl, provider };
    }
    return { iceServers: STUN, ttl: 0, provider: 'none' };
  }

  return { iceServersFor, provider, STUN };
}

module.exports = { createTurn };
