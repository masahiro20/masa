// COMPASS Meet — 打ち合わせ記録（担当者だけ）
'use strict';
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const toast = (t) => { const e = $('toast'); e.textContent = t; e.classList.remove('hidden'); clearTimeout(toast.t); toast.t = setTimeout(() => e.classList.add('hidden'), 2800); };
async function jfetch(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  let j = {}; try { j = await r.json(); } catch (_) { /* 空 */ }
  return { ok: r.ok, status: r.status, body: j };
}
const fmt = (t) => (t ? new Date(t).toLocaleString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const MIN_STATUS = { none: '未作成', manual: '手入力・未確定', ai_draft: 'AI 生成・確認前', confirmed: '確認済み' };
const SECTIONS = [['requests.layout', 'ご要望：間取り'], ['requests.design', 'ご要望：デザイン'], ['requests.equipment', 'ご要望：設備'], ['requests.budget', 'ご要望：予算'], ['requests.other', 'ご要望：その他'], ['decisions', '決定事項'], ['pending', '未決定事項']];
const getPath = (o, p) => p.split('.').reduce((x, k) => (x ? x[k] : undefined), o);
const setPath = (o, p, v) => { const ks = p.split('.'); let x = o; for (const k of ks.slice(0, -1)) x = x[k] = x[k] || {}; x[ks[ks.length - 1]] = v; };

let current = null;

async function init() {
  const me = await jfetch('/api/auth/me');
  if (!me.ok) { $('needLogin').classList.remove('hidden'); return; }
  $('whoName').textContent = `${me.body.staff.name} さん`;
  $('layout').classList.remove('hidden');
  await loadList();
  const id = location.hash.slice(1);
  if (/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(id)) open(id);
}

async function loadList() {
  const r = await jfetch('/api/meetings');
  const box = $('list'); box.textContent = '';
  if (!r.ok || !r.body.rooms.length) { box.appendChild(el('p', 'muted small', 'まだ記録はありません。')); return; }
  for (const m of r.body.rooms) {
    const a = el('a', 'mrow link-row'); a.href = `#${m.id}`; a.dataset.id = m.id;
    const t = el('div', 'mt');
    t.appendChild(el('b', '', m.title));
    t.appendChild(el('span', 'muted small', `${fmt(m.start || m.createdAt)}${m.customerName ? `・${m.customerName} 様` : ''}`));
    a.append(t, el('span', `pill m-${m.minutes}`, MIN_STATUS[m.minutes] || ''));
    a.onclick = (e) => { e.preventDefault(); history.replaceState(null, '', `#${m.id}`); open(m.id); };
    box.appendChild(a);
  }
}

async function open(id) {
  for (const a of document.querySelectorAll('.link-row')) a.classList.toggle('on', a.dataset.id === id);
  const r = await jfetch(`/api/meetings/${id}`);
  const d = $('detail'); d.textContent = '';
  if (!r.ok) { d.appendChild(el('p', 'muted', r.body.error || '記録が見つかりません')); return; }
  current = r.body;
  const m = r.body.meeting;
  const head = el('div', 'rec-head');
  head.appendChild(el('h2', '', m.title));
  head.appendChild(el('p', 'muted', `${fmt(m.start || m.createdAt)}${m.end ? ` 〜 ${new Date(m.end).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}` : ''}・担当 ${m.ownerName}`));
  const meta = el('div', 'chips');
  if (m.customerName) meta.appendChild(el('span', 'chip', `お客様：${m.customerName}`));
  if (m.customerId) meta.appendChild(el('span', 'chip', `顧客 ID：${m.customerId}`));
  if (m.projectId) meta.appendChild(el('span', 'chip', `案件 ID：${m.projectId}`));
  const names = [...new Set(m.log.filter((e) => e.kind === 'joined').map((e) => `${e.name}${e.role === 'host' ? '（担当）' : ''}`))];
  if (names.length) meta.appendChild(el('span', 'chip', `参加：${names.join('、')}`));
  head.appendChild(meta);
  const acts = el('div', 'row');
  if (current.can.download) { const b = el('button', 'btn sm', 'ダウンロード（Markdown）'); b.onclick = () => download(id); acts.appendChild(b); }
  if (current.can.delete) { const b = el('button', 'btn sm ghost danger-text', 'この記録を削除'); b.onclick = () => remove(id); acts.appendChild(b); }
  head.appendChild(acts);
  d.appendChild(head);

  d.appendChild(notesSection(m));
  d.appendChild(minutesSection(m));
  if (m.transcript.length) {
    const s = section('文字起こし');
    for (const t of m.transcript) { const p = el('p', 'tline'); p.id = `src-${t.id}`; p.append(el('span', 'sid', t.id), el('b', '', `${t.name}：`), document.createTextNode(t.text)); s.appendChild(p); }
    d.appendChild(s);
  }
  if (m.chat.length) {
    const s = section('チャット（保存したもの）');
    for (const c of m.chat) s.appendChild(el('p', 'tline', `${new Date(c.at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })} ${c.name}：${c.text}`));
    d.appendChild(s);
  }
  const lg = section('出入りの記録');
  const kinds = { joined: '入室', left: '退出', kicked: '退出（担当者の操作）', ended: '打ち合わせ終了', 'rec-request': '文字起こしを依頼', 'rec-consent': '文字起こしに同意', 'rec-declined': '文字起こしに同意せず', 'rec-stop': '文字起こしを停止' };
  for (const e of m.log) lg.appendChild(el('p', 'tline small', `${new Date(e.at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })} ${e.name || ''} ${kinds[e.kind] || e.kind}`));
  d.appendChild(lg);
}

function section(title) { const s = el('section', 'rec-sec'); s.appendChild(el('h3', '', title)); return s; }

function notesSection(m) {
  const s = section('メモ');
  const edit = current.can.edit;
  const fields = [['body', 'メモ', 6], ['decisions', '決定事項', 3], ['pending', '未決定事項', 3], ['todos', '次回までの確認事項', 3]];
  const inputs = {};
  for (const [k, label, rows] of fields) {
    const f = el('div', 'field');
    f.appendChild(el('label', '', label));
    const ta = document.createElement('textarea'); ta.rows = rows; ta.value = m.notes[k] || ''; ta.disabled = !edit;
    inputs[k] = ta; f.appendChild(ta); s.appendChild(f);
  }
  if (edit) {
    const b = el('button', 'btn primary sm', 'メモを保存');
    b.onclick = async () => {
      const r = await jfetch(`/api/meetings/${m.id}/notes`, { method: 'PUT', body: JSON.stringify(Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, v.value]))) });
      toast(r.ok ? 'メモを保存しました' : (r.body.error || '保存できませんでした'));
    };
    s.appendChild(b);
  }
  if (m.notes.updatedAt) s.appendChild(el('p', 'muted small', `最終更新：${fmt(m.notes.updatedAt)}（${m.notes.updatedBy}）`));
  return s;
}

function emptyMinutes() { return { overview: '', requests: { layout: [], design: [], equipment: [], budget: [], other: [] }, decisions: [], pending: [], todos: [], suggestedAgenda: [] }; }

function minutesSection(m) {
  const s = section('議事録');
  const st = m.minutes.status || 'none';
  const badge = el('span', `pill m-${st}`, MIN_STATUS[st]);
  s.querySelector('h3').appendChild(badge);
  const c = m.minutes.content || emptyMinutes();
  if (st === 'ai_draft') s.appendChild(el('p', 'notice warn', 'AI が作成した下書きです。発言にない内容が混ざっていないか、特に「要確認」の金額・寸法・日付を必ず確かめてから「確定」してください。'));

  // 表示
  const view = el('div', 'min-view');
  view.appendChild(el('h4', '', '打ち合わせ概要'));
  view.appendChild(el('p', '', c.overview || '（なし）'));
  for (const [path, label] of SECTIONS) {
    const items = getPath(c, path) || [];
    view.appendChild(el('h4', '', label));
    const ul = el('ul');
    if (!items.length) ul.appendChild(el('li', 'muted', '（なし）'));
    for (const it of items) ul.appendChild(itemLi(it.text, it));
    view.appendChild(ul);
  }
  view.appendChild(el('h4', '', '次回までの宿題'));
  const ul = el('ul');
  if (!c.todos.length) ul.appendChild(el('li', 'muted', '（なし）'));
  for (const t of c.todos) ul.appendChild(itemLi(`${t.who || '未定'}：${t.what}${t.due ? `（期限：${t.due}）` : ''}`, t));
  view.appendChild(ul);
  view.appendChild(el('h4', '', '次回の議題（AI の提案）'));
  const ag = el('ul');
  if (!c.suggestedAgenda.length) ag.appendChild(el('li', 'muted', '（なし）'));
  for (const a of c.suggestedAgenda) ag.appendChild(el('li', 'proposal', a.text));
  view.appendChild(ag);
  s.appendChild(view);

  if (!current.can.edit) return s;
  const row = el('div', 'row');
  if (current.ai) {
    const g = el('button', 'btn sm', st === 'none' ? 'AI で下書きを作る' : 'AI で作り直す');
    g.onclick = async () => {
      g.disabled = true; g.textContent = '作成中…';
      const r = await jfetch(`/api/meetings/${m.id}/summarize`, { method: 'POST', body: '{}' });
      if (!r.ok) { toast(r.body.error || '作成できませんでした'); g.disabled = false; g.textContent = 'AI で下書きを作る'; return; }
      open(m.id);
    };
    row.appendChild(g);
  } else {
    row.appendChild(el('span', 'muted small', 'AI 要約は未設定です（外部 AI への送信は、社内の承認と設定が済むまで使えません）。'));
  }
  const e = el('button', 'btn sm', '編集する');
  e.onclick = () => { s.replaceWith(minutesEditor(m, c)); };
  row.appendChild(e);
  if (st !== 'confirmed' && st !== 'none') {
    const ok = el('button', 'btn primary sm', '内容を確認して確定');
    ok.onclick = async () => {
      if (!confirm('内容を確認しましたか？確定すると「確認済み」になります。')) return;
      const r = await jfetch(`/api/meetings/${m.id}/minutes`, { method: 'PUT', body: JSON.stringify({ content: c, confirm: true }) });
      toast(r.ok ? '確定しました' : (r.body.error || '確定できませんでした')); if (r.ok) { open(m.id); loadList(); }
    };
    row.appendChild(ok);
  }
  s.appendChild(row);
  if (m.minutes.confirmedAt) s.appendChild(el('p', 'muted small', `確定：${fmt(m.minutes.confirmedAt)}（${m.minutes.confirmedBy}）`));
  return s;
}

function itemLi(text, it) {
  const li = el('li', it.needsCheck ? 'needs-check' : '');
  li.appendChild(document.createTextNode(text));
  if (it.needsCheck) li.appendChild(el('span', 'flag', '要確認'));
  for (const src of it.sources || []) {
    const a = el('a', 'src', src === 'note' ? 'メモ' : src);
    a.href = `#src-${src}`;
    a.onclick = (e) => { e.preventDefault(); const t = document.getElementById(`src-${src}`); if (t) { t.scrollIntoView({ behavior: 'smooth', block: 'center' }); t.classList.add('hl'); setTimeout(() => t.classList.remove('hl'), 2000); } };
    li.appendChild(a);
  }
  return li;
}

function minutesEditor(m, c) {
  const s = section('議事録を編集');
  s.appendChild(el('p', 'muted small', '1 行に 1 項目で書いてください。宿題は「誰が：何を：いつまでに」の形で書けます。'));
  const areas = {};
  const ov = document.createElement('textarea'); ov.rows = 3; ov.value = c.overview;
  s.append(el('label', '', '打ち合わせ概要'), ov);
  for (const [path, label] of SECTIONS) {
    const ta = document.createElement('textarea'); ta.rows = 3; ta.value = (getPath(c, path) || []).map((x) => x.text).join('\n');
    areas[path] = ta; s.append(el('label', '', label), ta);
  }
  const td = document.createElement('textarea'); td.rows = 3; td.value = c.todos.map((t) => [t.who, t.what, t.due].filter((x, i) => x || i === 1).join('：')).join('\n');
  s.append(el('label', '', '次回までの宿題'), td);
  const row = el('div', 'row');
  const save = (confirmIt) => async () => {
    const next = emptyMinutes();
    next.overview = ov.value;
    for (const [path] of SECTIONS) {
      const prev = getPath(c, path) || [];
      // 変えていない行は、出典と「要確認」の印をそのまま残す
      setPath(next, path, areas[path].value.split('\n').map((x) => x.trim()).filter(Boolean).map((text) => { const p = prev.find((x) => x.text === text); return p ? { ...p } : { text, sources: [], needsCheck: false }; }));
    }
    next.todos = td.value.split('\n').map((x) => x.trim()).filter(Boolean).map((line) => {
      const parts = line.split(/[：:]/).map((x) => x.trim());
      const t = parts.length >= 3 ? { who: parts[0], what: parts[1], due: parts.slice(2).join('：') } : parts.length === 2 ? { who: parts[0], what: parts[1], due: '' } : { who: '', what: parts[0], due: '' };
      const p = c.todos.find((x) => x.what === t.what);
      return { ...t, sources: p ? p.sources : [], needsCheck: p ? p.needsCheck : false };
    });
    next.suggestedAgenda = c.suggestedAgenda;
    if (confirmIt && !confirm('内容を確認しましたか？確定すると「確認済み」になります。')) return;
    const r = await jfetch(`/api/meetings/${m.id}/minutes`, { method: 'PUT', body: JSON.stringify({ content: next, confirm: confirmIt }) });
    toast(r.ok ? (confirmIt ? '確定しました' : '保存しました') : (r.body.error || '保存できませんでした'));
    if (r.ok) { open(m.id); loadList(); }
  };
  const b1 = el('button', 'btn sm', '保存（未確定のまま）'); b1.onclick = save(false);
  const b2 = el('button', 'btn primary sm', '保存して確定'); b2.onclick = save(true);
  const b3 = el('button', 'btn ghost sm', 'やめる'); b3.onclick = () => open(m.id);
  row.append(b3, b1, b2);
  s.appendChild(row);
  return s;
}

async function download(id) {
  const r = await jfetch(`/api/meetings/${id}/export`);
  if (!r.ok) return toast(r.body.error || 'ダウンロードできませんでした');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([r.body.markdown], { type: 'text/markdown;charset=utf-8' }));
  a.download = r.body.filename; a.click();
}

async function remove(id) {
  if (!confirm('この打ち合わせ記録を削除します。元に戻せません。よろしいですか？')) return;
  const r = await jfetch(`/api/meetings/${id}`, { method: 'DELETE' });
  toast(r.ok ? '削除しました' : (r.body.error || '削除できませんでした'));
  if (r.ok) { $('detail').textContent = ''; history.replaceState(null, '', '/records'); loadList(); }
}

init();
