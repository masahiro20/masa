// COMPASS Meet — はじめの画面
'use strict';
const $ = (id) => document.getElementById(id);
const toast = (t) => {
  const el = $('toast');
  el.textContent = t;
  el.classList.remove('hidden');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.add('hidden'), 2500);
};
let made = null;

// 既定は今日・次の 30 分きざみ・1 時間
(function initDate() {
  const d = new Date(Date.now() + 30 * 60e3);
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  $('date').value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  $('start').value = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const e = new Date(d.getTime() + 60 * 60e3);
  $('end').value = `${pad(e.getHours())}:${pad(e.getMinutes())}`;
})();

async function createRoom(body) {
  const r = await fetch('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || '作成できませんでした');
  return j;
}

const isoLocal = (date, time) => (date && time ? `${date}T${time}` : '');
// 端末の時刻 → UTC の 20261117T010000Z
const stamp = (local) => new Date(local).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

$('create').onclick = async () => {
  const title = $('title').value.trim() || 'オンライン打ち合わせ';
  const start = isoLocal($('date').value, $('start').value);
  const end = isoLocal($('date').value, $('end').value);
  try { made = await createRoom({ title, start, end }); } catch (e) { return toast(e.message); }
  $('url').textContent = made.url;
  $('open').href = made.url;
  const q = new URLSearchParams({ action: 'TEMPLATE', text: title, details: `オンライン打ち合わせ（COMPASS Meet）\n${made.url}`, location: made.url });
  if (start && end) q.set('dates', `${stamp(start)}/${stamp(end)}`);
  $('gcal').href = `https://calendar.google.com/calendar/render?${q}`;
  $('result').classList.remove('hidden');
};

$('now').onclick = async () => {
  try {
    const r = await createRoom({ title: $('title').value.trim() || 'オンライン打ち合わせ' });
    location.href = r.url;
  } catch (e) { toast(e.message); }
};

async function copy(text, msg) {
  try { await navigator.clipboard.writeText(text); toast(msg); }
  catch (_) { prompt('コピーしてください', text); }
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
    `DTSTART:${s}`, `DTEND:${e}`, `SUMMARY:${esc(made.title || 'オンライン打ち合わせ')}`,
    `LOCATION:${made.url}`, `URL:${made.url}`, `DESCRIPTION:${esc('オンライン打ち合わせ（COMPASS Meet）: ' + made.url)}`,
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  a.download = `${made.id}.ics`;
  a.click();
};

$('join').onclick = () => {
  const m = $('code').value.trim().match(/[a-z]{3}-[a-z]{4}-[a-z]{3}/);
  if (!m) return toast('通話コードは abc-defg-hij の形です');
  location.href = `/r/${m[0]}`;
};
$('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('join').click(); });
