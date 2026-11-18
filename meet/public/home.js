// COMPASS Meet — はじめの画面（社員ログイン・打ち合わせの作成・一覧）
'use strict';
const $ = (id) => document.getElementById(id);
const toast = (t) => {
  const e = $('toast'); e.textContent = t; e.classList.remove('hidden');
  clearTimeout(toast.t); toast.t = setTimeout(() => e.classList.add('hidden'), 2800);
};
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
let made = null;

async function jfetch(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  let j = {}; try { j = await r.json(); } catch (_) { /* 空 */ }
  return { ok: r.ok, status: r.status, body: j };
}

(function initDate() {
  const d = new Date(Date.now() + 30 * 60e3);
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  $('date').value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  $('start').value = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const e = new Date(d.getTime() + 60 * 60e3);
  $('end').value = `${pad(e.getHours())}:${pad(e.getMinutes())}`;
})();

const LOGIN_ERRORS = {
  domain: '会社の Google アカウント（@{d}）でログインしてください。個人のアカウントでは入れません。',
  notallowed: 'このアカウントには、まだ利用の許可がありません。管理者にお問い合わせください。',
  cancelled: 'ログインを取りやめました。',
  state: 'ログインの確認に失敗しました。もう一度お試しください。',
  expired: 'ログインの有効時間が切れました。もう一度お試しください。',
  token: 'Google での確認に失敗しました。もう一度お試しください。',
  toomany: 'ログインの失敗が続いたため、しばらくお待ちください。',
};
let cfg = {};
async function refreshMe() {
  cfg = (await jfetch('/api/config')).body || {};
  $('googleBtn').classList.toggle('hidden', !cfg.googleLogin);
  $('loginForm').classList.toggle('hidden', !cfg.staffLogin);
  if (cfg.googleLogin) $('loginLead').textContent = `打ち合わせのリンクを作るには、会社の Google アカウント（@${cfg.googleDomain}）でログインしてください。`;
  else if (cfg.staffLogin) $('loginLead').textContent = '打ち合わせのリンクを作るには、社員 ID でログインしてください。';
  else $('loginLead').textContent = 'ログインの設定がまだされていません。管理者にお問い合わせください。';
  const err = new URLSearchParams(location.search).get('login_error');
  if (err && LOGIN_ERRORS[err]) {
    $('googleErr').textContent = LOGIN_ERRORS[err].replace('{d}', cfg.googleDomain || '会社のドメイン');
    $('googleErr').classList.remove('hidden');
    history.replaceState(null, '', '/');
  }
  const r = await jfetch('/api/auth/me');
  const signed = r.ok;
  $('loginBox').classList.toggle('hidden', signed);
  $('createBox').classList.toggle('hidden', !signed);
  $('listBox').classList.toggle('hidden', !signed);
  $('whoBox').classList.toggle('hidden', !signed);
  if (signed) { $('whoName').textContent = `${r.body.staff.name} さん`; loadList(); }
}

$('loginForm').onsubmit = async (e) => {
  e.preventDefault();
  $('loginErr').classList.add('hidden');
  const r = await jfetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ id: $('loginId').value.trim(), password: $('loginPw').value }) });
  $('loginPw').value = '';
  if (!r.ok) { $('loginErr').textContent = r.body.error || 'ログインできませんでした'; $('loginErr').classList.remove('hidden'); return; }
  refreshMe();
};
$('logout').onclick = async () => { await jfetch('/api/auth/logout', { method: 'POST', body: '{}' }); refreshMe(); };

const toIso = (date, time) => (date && time ? new Date(`${date}T${time}`).toISOString() : undefined);
const stamp = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

async function create(now) {
  const body = {
    title: $('title').value.trim() || 'オンライン打ち合わせ',
    customerName: $('customerName').value.trim() || undefined,
    customerId: $('customerId').value.trim() || undefined,
    pin: $('usePin').checked,
  };
  if (!now) { body.start = toIso($('date').value, $('start').value); body.end = toIso($('date').value, $('end').value); }
  const r = await jfetch('/api/rooms', { method: 'POST', body: JSON.stringify(body) });
  if (!r.ok) { toast(r.body.error || '作成できませんでした'); if (r.status === 401) refreshMe(); return null; }
  return { ...r.body, start: body.start, end: body.end };
}

$('create').onclick = async () => {
  made = await create(false);
  if (!made) return;
  $('url').textContent = made.url;
  $('open').href = made.url;
  $('pinBox').classList.toggle('hidden', !made.pin);
  $('pinVal').textContent = made.pin || '';
  // お客様向けの予定には件名だけを入れる（お客様名・顧客 ID は入れない）
  const q = new URLSearchParams({ action: 'TEMPLATE', text: made.title, details: `オンライン打ち合わせ（COMPASS Meet）\n${made.url}`, location: made.url });
  if (made.start && made.end) q.set('dates', `${stamp(made.start)}/${stamp(made.end)}`);
  $('gcal').href = `https://calendar.google.com/calendar/render?${q}`;
  $('result').classList.remove('hidden');
  loadList();
};

$('now').onclick = async () => {
  const r = await create(true);
  if (!r) return;
  if (r.pin) { await navigator.clipboard.writeText(r.pin).catch(() => {}); alert(`確認コード：${r.pin}\n（お客様にお伝えください。クリップボードにもコピーしました）`); }
  location.href = r.url;
};

async function copy(text, msg) {
  try { await navigator.clipboard.writeText(text); toast(msg); } catch (_) { prompt('コピーしてください', text); }
}
$('copy').onclick = () => copy(made.url, 'リンクをコピーしました');
$('copyMemo').onclick = () => copy(`オンライン打ち合わせ ${made.url}`, 'COMPASS の予定メモに貼り付けてください');

$('ics').onclick = () => {
  if (!made) return;
  const s = made.start ? stamp(made.start) : stamp(new Date().toISOString());
  const e = made.end ? stamp(made.end) : s;
  const esc = (t) => t.replace(/[\\;,]/g, (m) => '\\' + m).replace(/\n/g, '\\n');
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//COMPASS Meet//JA', 'BEGIN:VEVENT',
    `UID:${made.id}@compass-meet`, `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${s}`, `DTEND:${e}`, `SUMMARY:${esc(made.title)}`,
    `LOCATION:${made.url}`, `URL:${made.url}`, `DESCRIPTION:${esc('オンライン打ち合わせ（COMPASS Meet）: ' + made.url)}`,
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  a.download = `${made.id}.ics`;
  a.click();
};

const STATUS = { open: '予定・開催中', ended: '終了', expired: '期限切れ', gone: '削除済み' };
async function loadList() {
  const r = await jfetch('/api/rooms');
  const box = $('list');
  if (!r.ok) return;
  box.textContent = '';
  if (!r.body.rooms.length) { box.appendChild(el('p', 'muted small', 'まだありません。')); return; }
  for (const m of r.body.rooms.slice(0, 8)) {
    const row = el('div', 'mrow');
    const t = el('div', 'mt');
    t.appendChild(el('b', '', m.title));
    const when = m.start ? new Date(m.start).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' }) : new Date(m.createdAt).toLocaleDateString('ja-JP');
    t.appendChild(el('span', 'muted small', `${when}${m.customerName ? `・${m.customerName} 様` : ''}`));
    const st = el('span', `pill s-${m.status}`, STATUS[m.status] || m.status);
    const acts = el('div', 'mact');
    if (m.status === 'open') {
      const op = el('a', 'btn sm', '開く'); op.href = `/r/${m.id}`;
      const cp = el('button', 'btn sm ghost', 'リンク'); cp.onclick = () => copy(`${location.origin}/r/${m.id}`, 'お客様用のリンクをコピーしました');
      acts.append(cp, op);
    }
    const rec = el('a', 'btn sm ghost', '記録'); rec.href = `/records#${m.id}`;
    acts.appendChild(rec);
    row.append(t, st, acts);
    box.appendChild(row);
  }
}

$('join').onclick = () => {
  const m = $('code').value.trim().match(/[a-z]{3}-[a-z]{4}-[a-z]{3}/);
  if (!m) return toast('通話コードは abc-defg-hij の形です');
  location.href = `/r/${m[0]}`;
};
$('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('join').click(); });

refreshMe();
