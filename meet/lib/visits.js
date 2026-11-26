'use strict';
// 対面の打ち合わせの録音（受け渡し箱）
//
// 流れ：
//   1) 局長が対面モードで録音 → 録った分を約 20 秒ごとに、ここへ小分けにして送る（暗号化して一時保管）
//   2) 録音が終わると、サーバーがその担当者本人の Google ドライブへ直接置く（lib/drive.js）
//      お客様のフォルダ（無ければ マイドライブ「録音」）。ドライブにつないでいない人の分は受け渡し箱に残り、
//      つないだ後・次に開いたときに自動で置く。局長の Claude が受け渡し箱から取り出す道も残す
//   3) ドライブに置けたら、ここの音声は消す（記録＝誰の・いつの録音か・どこに置いたかだけ残す）。
//      COMPASS へは、ドライブに置いたファイルから入れる（局長のパソコンの Chrome 経由）
// 文字起こしは端末の中だけで作ったもの（声を外に送らない）を、録音と一緒に受け取って同じ場所に置く。
// 音声そのものは外部の AI には送らない。保管は最大 14 日で自動的に消える。

const crypto = require('node:crypto');

const VISIT_ID_RE = /^v[a-z0-9]{16}$/;
const CHUNK_MAX = 600 * 1024;          // 1 回に送れる量（base64 の文字数。保管先の 1 件の上限に収まるように）
const MAX_CHUNKS = 600;                // 約 3 時間分まで
const TEXT_MAX = 200000;               // 文字起こしの上限（文字数）
const STALE_MS = 10 * 60 * 1000;       // これだけ送られてこなければ「途中で止まった」とみなし、そこまでを保存する
const AUDIO_TTL = 14 * 86400;
const META_TTL = 180 * 86400;

function createVisits({ store, seal, unseal, auth, limiter, ok, fail, tooMany, clean, drive }) {
  const metaKey = (id) => `visit:${id}`;
  const chunkKey = (id, seq) => `visitc:${id}:${seq}`;
  const textKey = (id) => `visitt:${id}`;
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
    hasText: !!v.hasText, textChars: v.textChars || 0, driveError: v.driveError || '', interrupted: !!v.interrupted,
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
          await finalizeStale(v);
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
      if (m === 'GET' && parts[4] === 'text') {
        const text = await loadText(id);
        return text == null ? fail(404, '文字起こしはありません') : ok({ text });
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
        await purgeIfFiled(v);
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
          const v = await load(id); if (!v) continue;
          await finalizeStale(v);
          if (v.status !== 'empty') out.push(pub(v));
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

    // ドライブにまだ置いていない自分の録音を、まとめて置く（ページを開いたときに呼ぶ）
    if (sub === 'sync' && m === 'POST') {
      const st = drive ? await drive.status(staff.id) : { enabled: false };
      if (!st.connected) { await sweep({ upload: false, onlyOwner: staff.id }); return ok({ done: [], drive: st }); }
      const idx = await hgetall(INDEX); const done = [];
      for (const [id, owner] of Object.entries(idx)) {
        if (owner !== staff.id || done.length >= 2) continue;
        const x = await load(id);
        await finalizeStale(x);
        if (!x || x.status !== 'ready' || x.drive || x.purged) continue;
        const r = await toDrive(x, staff);
        done.push({ id, ok: !r.error, error: r.error || '' });
        if (r.error === 'connect') break;
      }
      return ok({ done, drive: st });
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
      const cmds = [['SET', chunkKey(v.id, seq), seal(b.data, `vc:${v.id}:${seq}`), 'EX', AUDIO_TTL]];
      // 途中で電池が切れても、そこまでを保存できるように、進み具合と途中までの文字起こしも残す
      v.lastChunkAt = Date.now(); v.maxSeq = Math.max(v.maxSeq ?? -1, seq);
      if (!v.mime && typeof b.mime === 'string') v.mime = clean(b.mime, 60);
      if (Number.isFinite(b.elapsedMs)) v.elapsedMs = Math.max(v.elapsedMs || 0, Math.min(Number(b.elapsedMs), 6 * 3600e3));
      if (typeof b.text === 'string' && b.text.trim()) {
        const text = b.text.replace(/\r\n?/g, '\n').slice(0, TEXT_MAX);
        cmds.push(['SET', textKey(v.id), seal(text, `vt:${v.id}`), 'EX', META_TTL]);
        v.hasText = true; v.textChars = text.length;
      }
      await store.pipeline(cmds);
      await save(v);
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
      v.status = 'ready'; v.interrupted = false;
      if (typeof b.text === 'string' && b.text.trim()) {
        const text = b.text.replace(/\r\n?/g, '\n').slice(0, TEXT_MAX);
        await store.pipeline([['SET', textKey(v.id), seal(text, `vt:${v.id}`), 'EX', META_TTL]]);
        v.hasText = true; v.textChars = text.length;
      }
      await save(v);
      return ok({ ok: true, visit: pub(v) });
    }
    // 端末の控え（全部そろったもの）で送り直す：まだドライブに置いていなければ、受け付け直す
    if (m === 'POST' && parts[3] === 'reopen') {
      if (v.drive || v.purged) return fail(409, 'この録音はもうドライブに置いてあります');
      v.status = 'recording'; v.interrupted = false; v.lastChunkAt = Date.now();
      await save(v);
      return ok({ ok: true, visit: pub(v) });
    }
    // ドライブへ置く（終了の直後に画面から呼ぶ。失敗しても受け渡し箱に残り、あとで置き直せる）
    if (m === 'POST' && parts[3] === 'drive') {
      const r = await limiter.hit('visit_drive', staff.id);
      if (!r.ok) return tooMany(r);
      if (v.drive) return ok({ ok: true, visit: pub(v) });
      if (v.status !== 'ready') return fail(409, 'まだ録音が締め切られていません');
      if (v.purged) return fail(410, '音声はもう残っていません');
      const res = await toDrive(v, staff);
      if (res.error === 'connect') return ok({ ok: false, need: 'connect', error: res.message, visit: pub(v) }, 409);
      if (res.error) return ok({ ok: false, error: res.message, visit: pub(v) }, 502);
      return ok({ ok: true, visit: pub(v) });
    }
    if (m === 'GET' && parts[3] === 'text') {
      const text = await loadText(v.id);
      return text == null ? fail(404, '文字起こしはありません') : ok({ text });
    }
    if (m === 'GET' && !parts[3]) return ok({ visit: pub(v) });
    return fail(404, '見つかりません');
  }

  // 途中で止まった録音（電池切れ・端末が落ちた等）を、届いているところまでで締める
  async function finalizeStale(v, now = Date.now()) {
    if (!v || v.status !== 'recording') return false;
    const last = v.lastChunkAt || v.startedAt;
    if (now - last < STALE_MS) return false;
    if ((v.maxSeq ?? -1) < 0) { v.status = 'empty'; await save(v); return false; }
    const n = v.maxSeq + 1;
    const got = await store.pipeline(Array.from({ length: n }, (_, i) => ['EXISTS', chunkKey(v.id, i)]));
    let count = 0; while (count < n && Number(got[count])) count++;
    if (!count) { v.status = 'empty'; await save(v); return false; }
    v.chunks = count; v.status = 'ready'; v.interrupted = true; v.endedAt = last;
    v.durationMs = v.elapsedMs || Math.max(0, last - v.startedAt);
    v.mime = v.mime || 'audio/mp4';
    await save(v);
    return true;
  }
  // 全員分の見回り（1 日 1 回の定期実行と、画面を開いたときに呼ぶ）
  async function sweep({ upload = true, onlyOwner = null, limit = 5 } = {}) {
    const idx = await hgetall(INDEX); const out = { finalized: 0, uploaded: 0, failed: 0 };
    for (const [id, owner] of Object.entries(idx)) {
      if (onlyOwner && owner !== onlyOwner) continue;
      const v = await load(id); if (!v) continue;
      if (await finalizeStale(v)) out.finalized++;
      if (!upload || out.uploaded + out.failed >= limit) continue;
      if (v.status !== 'ready' || v.drive || v.purged || !drive || !drive.enabled) continue;
      const st = await drive.status(owner); if (!st.connected) continue;
      const r = await toDrive(v, { id: owner });
      if (r.error) out.failed++; else out.uploaded++;
    }
    return out;
  }

  async function loadText(id) {
    const [raw] = await store.pipeline([['GET', textKey(id)]]);
    return raw ? unseal(raw, `vt:${id}`) : null;
  }
  async function purgeIfFiled(v) {
    if (v.drive && !v.purged) {
      const dels = []; for (let i = 0; i < (v.chunks || 0); i++) dels.push(chunkKey(v.id, i));
      if (dels.length) await store.pipeline([['DEL', ...dels]]);
      v.purged = true;
    }
    v.status = v.drive && v.compass !== 'pending' ? 'filed' : 'ready';
  }
  // ドライブ用のファイル名：「2026-11-26 1400 大崎純様 打ち合わせ.m4a」
  function driveName(v, ext) {
    const d = new Date(v.startedAt + 9 * 3600e3); // 日本時間
    const p = (n) => String(n).padStart(2, '0');
    const who = String(v.customerName).replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '').replace(/様$/, '');
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}${p(d.getUTCMinutes())} ${who}様 ${String(v.title).replace(/[\\/:*?"<>|]/g, '')}${v.interrupted ? '（途中まで）' : ''}.${ext}`;
  }
  async function toDrive(v, staff) {
    if (!drive || !drive.enabled) return { error: 'disabled', message: 'ドライブへの自動保存は、まだ設定されていません' };
    try {
      const bufs = [];
      for (let i = 0; i < (v.chunks || 0); i++) {
        const [raw] = await store.pipeline([['GET', chunkKey(v.id, i)]]);
        const data = raw ? unseal(raw, `vc:${v.id}:${i}`) : null;
        if (!data) return { error: 'gone', message: '音声の一部が残っていません' };
        bufs.push(Buffer.from(data, 'base64'));
      }
      const audio = Buffer.concat(bufs);
      const ext = /mp4|m4a|aac/.test(v.mime) ? 'm4a' : 'webm';
      const text = v.hasText ? await loadText(v.id) : null;
      const head = `${v.customerName} ${v.title}\n${new Date(v.startedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}　担当：${v.ownerName}\n（この端末の中だけで作った文字起こしです。聞き間違いがあります。正しくは録音を確かめてください）\n${v.interrupted ? '（電池切れなどで途中で止まったため、届いたところまでを保存しています）\n' : ''}\n`;
      const saved = await drive.save(staff.id, {
        customerName: v.customerName, title: v.title, fileName: driveName(v, ext), mime: ext === 'm4a' ? 'audio/mp4' : 'audio/webm', audio,
        textName: driveName(v, 'txt').replace(/\.txt$/, ' 文字起こし.txt'), text: text ? head + text : '',
        description: `COMPASS Meet 対面の録音（${v.customerName}・${v.title}・担当 ${v.ownerName}）`,
      });
      v.drive = { fileId: saved.fileId, name: saved.name, folder: saved.folder, where: saved.where, link: saved.link, textFileId: saved.textFileId, at: Date.now() };
      v.driveError = '';
      await purgeIfFiled(v);
      await save(v);
      return { ok: true };
    } catch (e) {
      v.driveError = String(e.message || 'ドライブに置けませんでした').slice(0, 200);
      await save(v);
      return { error: e.code === 'connect' ? 'connect' : 'failed', message: v.driveError };
    }
  }

  async function hgetall(k) {
    const [arr] = await store.pipeline([['HGETALL', k]]);
    const o = {}; for (let i = 0; i < (arr || []).length; i += 2) o[arr[i]] = arr[i + 1];
    return o;
  }

  return { handle, sweep, _finalizeStale: finalizeStale };
}

module.exports = { createVisits };
