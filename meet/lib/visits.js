'use strict';
// 対面の打ち合わせの録音（受け渡し箱）
//
// 流れ：
//   1) 局長が対面モードで録音 → 録った分を約 20 秒ごとに、ここへ小分けにして送る（暗号化して一時保管）
//   2) 局長の Claude が、受け渡し箱（/api/visits/inbox）から取り出して、お客様のドライブのフォルダ
//      （無ければ マイドライブ「録音」）に置き、COMPASS のお客様の録音の置き場所にも入れる
//   3) ドライブに置けたら知らせてもらい、ここの音声は消す（記録＝誰の・いつの録音か・どこに置いたかだけ残す）。
//      COMPASS へは、ドライブに置いたファイルから入れる（局長のパソコンの Chrome 経由）
// 音声そのものは外部の AI には送らない。保管は最大 14 日で自動的に消える。

const crypto = require('node:crypto');

const VISIT_ID_RE = /^v[a-z0-9]{16}$/;
const CHUNK_MAX = 600 * 1024;          // 1 回に送れる量（base64 の文字数。保管先の 1 件の上限に収まるように）
const MAX_CHUNKS = 600;                // 約 3 時間分まで
const AUDIO_TTL = 14 * 86400;
const META_TTL = 180 * 86400;

function createVisits({ store, seal, unseal, auth, limiter, ok, fail, tooMany, clean }) {
  const metaKey = (id) => `visit:${id}`;
  const chunkKey = (id, seq) => `visitc:${id}:${seq}`;
  const INDEX = 'visits:index';

  async function load(id) {
    const [raw] = await store.pipeline([['GET', metaKey(id)]]);
    return raw ? unseal(raw, `visit:${id}`) : null;
  }
  async function save(v) {
    await store.pipeline([
      ['SET', metaKey(v.id), seal(v, `visit:${v.id}`), 'EX', META_TTL],
      ['HSET', INDEX, v.id, v.ownerId],
    ]);
  }
  const pub = (v) => ({
    id: v.id, customerName: v.customerName, compassId: v.compassId, title: v.title, startedAt: v.startedAt, endedAt: v.endedAt || 0,
    durationMs: v.durationMs || 0, mime: v.mime, chunks: v.chunks || 0, bytes: v.bytes || 0, status: v.status,
    drive: v.drive || null, compass: v.compass || 'pending', ownerName: v.ownerName, audioKept: !v.purged,
  });

  async function staffFor(req, write) {
    const staff = await auth.staffOf(req);
    if (!staff) return { err: fail(401, 'ログインが必要です') };
    if (write && staff.cookie && !auth.sameOrigin(req)) return { err: fail(403, '不正な送信元です') };
    return { staff };
  }
  const mine = (v, staff) => v && (v.ownerId === staff.id || staff.role === 'admin');

  async function handle(req, parts) {
    const m = req.method;
    const sub = parts[2] || '';

    // ---- 局長の Claude 用：受け渡し箱（サーバー間のキーだけで使える）----
    if (sub === 'inbox') {
      const staff = await auth.staffOf(req);
      if (!staff || staff.via !== 'apikey') return fail(401, 'サーバー間のキーが必要です');
      if (m === 'GET' && !parts[3]) {
        const ids = Object.keys(Object.fromEntries(Object.entries(await hgetall(INDEX))));
        const out = [];
        for (const id of ids) {
          const v = await load(id);
          if (!v) { await store.pipeline([['HDEL', INDEX, id]]); continue; }
          if (v.status === 'ready' && (!v.drive || v.compass === 'pending')) out.push(pub(v));
        }
        out.sort((a, b) => a.startedAt - b.startedAt);
        return ok({ visits: out });
      }
      const id = parts[3];
      if (!VISIT_ID_RE.test(id || '')) return fail(404, '見つかりません');
      const v = await load(id);
      if (!v) return fail(404, '見つかりません');
      if (m === 'GET' && parts[4] === 'chunk') {
        const seq = Number(parts[5]);
        if (!Number.isInteger(seq) || seq < 0 || seq >= (v.chunks || 0)) return fail(404, 'その部分はありません');
        const [raw] = await store.pipeline([['GET', chunkKey(id, seq)]]);
        const data = raw ? unseal(raw, `vc:${id}:${seq}`) : null;
        if (!data) return fail(410, '音声はもう残っていません');
        return ok({ seq, data });
      }
      if (m === 'POST' && parts[4] === 'filed') {
        // 置き場所を知らせてもらう
        const b = req.body || {};
        if (b.drive && typeof b.drive === 'object') {
          v.drive = { fileId: clean(b.drive.fileId, 120), name: clean(b.drive.name, 200), folder: clean(b.drive.folder, 200), at: Date.now() };
        }
        if (['done', 'skipped', 'pending'].includes(b.compass)) v.compass = b.compass;
        if (typeof b.compassId === 'string' && /^[\w-]{1,40}$/.test(b.compassId)) v.compassId = b.compassId;
        // ドライブに置けたら、ここの音声は消す（COMPASS へは、ドライブに置いたファイルから入れる）
        if (v.drive && !v.purged) {
          const dels = []; for (let i = 0; i < (v.chunks || 0); i++) dels.push(chunkKey(id, i));
          if (dels.length) await store.pipeline([['DEL', ...dels]]);
          v.purged = true;
        }
        v.status = v.drive && v.compass !== 'pending' ? 'filed' : 'ready';
        await save(v);
        return ok({ ok: true, visit: pub(v) });
      }
      return fail(404, '見つかりません');
    }

    // ---- 局長（ブラウザ）用 ----
    const { staff, err } = await staffFor(req, m !== 'GET');
    if (err) return err;

    if (!sub) {
      if (m === 'GET') {
        const idx = await hgetall(INDEX);
        const out = [];
        for (const [id, owner] of Object.entries(idx)) {
          if (owner !== staff.id && staff.role !== 'admin') continue;
          const v = await load(id); if (v) out.push(pub(v));
        }
        out.sort((a, b) => b.startedAt - a.startedAt);
        return ok({ visits: out.slice(0, 50) });
      }
      if (m === 'POST') {
        const r = await limiter.hit('visit_create', staff.id);
        if (!r.ok) return tooMany(r);
        const b = req.body || {};
        const customerName = clean(b.customerName, 60);
        if (!customerName) return fail(400, 'お客様のお名前を入れてください');
        const id = `v${crypto.randomBytes(12).toString('base64').replace(/[^a-z0-9]/gi, '').toLowerCase().padEnd(16, '0').slice(0, 16)}`;
        const v = {
          id, ownerId: staff.id, ownerName: staff.name, customerName,
          compassId: typeof b.compassId === 'string' && /^[\w-]{1,40}$/.test(b.compassId) ? b.compassId : '',
          title: clean(b.title, 60) || '対面の打ち合わせ', startedAt: Date.now(), status: 'recording', chunks: 0, bytes: 0, mime: '', compass: 'pending',
        };
        await save(v);
        return ok({ visit: pub(v) }, 201);
      }
      return fail(405, '使えない操作です');
    }

    if (!VISIT_ID_RE.test(sub)) return fail(404, '見つかりません');
    const v = await load(sub);
    if (!mine(v, staff)) return fail(404, '見つかりません');

    if (m === 'POST' && parts[3] === 'chunk') {
      const r = await limiter.hit('visit_chunk', staff.id);
      if (!r.ok) return tooMany(r);
      if (v.status !== 'recording') return fail(409, 'この録音はもう締め切られています');
      const b = req.body || {};
      const seq = b.seq;
      if (!Number.isInteger(seq) || seq < 0 || seq >= MAX_CHUNKS) return fail(400, '番号が正しくありません');
      if (typeof b.data !== 'string' || !b.data || b.data.length > CHUNK_MAX || !/^[A-Za-z0-9+/=]+$/.test(b.data)) return fail(400, '音声の形式が正しくありません');
      await store.pipeline([['SET', chunkKey(v.id, seq), seal(b.data, `vc:${v.id}:${seq}`), 'EX', AUDIO_TTL]]);
      return ok({ ok: true, seq });
    }
    if (m === 'POST' && parts[3] === 'finish') {
      const b = req.body || {};
      const chunks = b.chunks;
      if (!Number.isInteger(chunks) || chunks < 1 || chunks > MAX_CHUNKS) return fail(400, '件数が正しくありません');
      // 全部そろっているかを確かめる（足りなければ、足りない番号を返して送り直してもらう）
      const got = await store.pipeline(Array.from({ length: chunks }, (_, i) => ['EXISTS', chunkKey(v.id, i)]));
      const missing = got.map((x, i) => (Number(x) ? -1 : i)).filter((i) => i >= 0);
      if (missing.length) return ok({ ok: false, missing: missing.slice(0, 100) }, 409);
      v.chunks = chunks;
      v.mime = clean(b.mime, 60) || 'audio/mp4';
      v.durationMs = Math.max(0, Math.min(Number(b.durationMs) || 0, 6 * 3600 * 1000));
      v.bytes = Math.max(0, Number(b.bytes) || 0);
      v.endedAt = Date.now();
      v.status = 'ready';
      await save(v);
      return ok({ ok: true, visit: pub(v) });
    }
    if (m === 'GET' && !parts[3]) return ok({ visit: pub(v) });
    return fail(404, '見つかりません');
  }

  async function hgetall(k) {
    const [arr] = await store.pipeline([['HGETALL', k]]);
    const o = {}; for (let i = 0; i < (arr || []).length; i += 2) o[arr[i]] = arr[i + 1];
    return o;
  }

  return { handle };
}

module.exports = { createVisits };
