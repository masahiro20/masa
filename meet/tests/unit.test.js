'use strict';
// 小さな部品の試験：暗号・置き場所・AI 議事録の検証
const test = require('node:test');
const assert = require('node:assert/strict');
const sec = require('../lib/secure');
const { createMemoryStore, createUpstashStore } = require('../lib/store');
const { verify, sanitizeMinutes, flagRisky, buildInput, createAi } = require('../lib/ai');

test('保存データの暗号化：用途（aad）が違えば読めない・改ざんすれば読めない', () => {
  const key = Buffer.alloc(32, 7);
  const s = sec.seal(key, { title: '山田様' }, 'room:a');
  assert.deepEqual(sec.open(key, s, 'room:a'), { title: '山田様' });
  assert.equal(sec.open(key, s, 'room:b'), null);
  const broken = s.slice(0, -2) + (s.endsWith('A') ? 'B' : 'A') + s.slice(-1);
  assert.equal(sec.open(key, broken, 'room:a'), null);
  assert.equal(sec.open(Buffer.alloc(32, 8), s, 'room:a'), null);
});

test('パスワードのハッシュ：正しいものだけ通る', () => {
  const h = sec.hashPassword('secret-pass');
  assert.ok(sec.verifyPassword('secret-pass', h));
  assert.ok(!sec.verifyPassword('secret-pasS', h));
  assert.ok(!sec.verifyPassword('secret-pass', undefined));
});

test('メモリの置き場所：SET NX / EX、INCR、リストの読み消し', async () => {
  const st = createMemoryStore();
  const [a, b] = await st.pipeline([['SET', 'k', 1, 'EX', 10, 'NX'], ['SET', 'k', 2, 'EX', 10, 'NX']]);
  assert.equal(a, 'OK');
  assert.equal(b, null);
  const [, n] = await st.pipeline([['SET', 'c', 0, 'EX', 5, 'NX'], ['INCR', 'c']]);
  assert.equal(n, 1);
  await st.pipeline([['RPUSH', 'l', 'x', 'y']]);
  const [items] = await st.multi([['LRANGE', 'l', 0, -1], ['DEL', 'l']]);
  assert.deepEqual(items, ['x', 'y']);
  assert.deepEqual((await st.pipeline([['LRANGE', 'l', 0, -1]]))[0], []);
});

test('Upstash の置き場所：pipeline / multi-exec を正しく組み立て、エラー本文をログに出さない', async () => {
  const sent = [];
  const fake = async (url, opts) => {
    sent.push({ url, auth: opts.headers.Authorization, cmds: JSON.parse(opts.body) });
    const result = JSON.parse(opts.body).map(() => ({ result: 'OK' }));
    return { ok: true, json: async () => (url.endsWith('/multi-exec') ? { result } : result) };
  };
  const st = createUpstashStore({ url: 'https://x.upstash.io/', token: 'tok', fetchImpl: fake });
  await st.pipeline([['SET', 'a', 1, 'EX', 5]]);
  await st.multi([['LRANGE', 'l', 0, -1], ['DEL', 'l']]);
  assert.equal(sent[0].url, 'https://x.upstash.io/pipeline');
  assert.equal(sent[1].url, 'https://x.upstash.io/multi-exec');
  assert.equal(sent[0].auth, 'Bearer tok');
  assert.deepEqual(sent[0].cmds, [['SET', 'a', '1', 'EX', '5']], '値はすべて文字列にして送る');
  const failing = createUpstashStore({ url: 'https://x', token: 't', fetchImpl: async () => ({ ok: false, status: 500, text: async () => 'secret body' }) });
  await assert.rejects(failing.pipeline([['GET', 'a']]), (e) => !e.message.includes('secret body'));
});

test('JWT：alg を書き換えたもの・署名が違うものは通らない', () => {
  const now = Math.floor(Date.now() / 1000);
  const tok = sec.signJwtHS256('s', { iss: 'compass', aud: 'compass-meet', sub: 'u', iat: now, exp: now + 60 });
  assert.ok(sec.verifyJwtHS256('s', tok, { iss: 'compass', aud: 'compass-meet' }));
  assert.equal(sec.verifyJwtHS256('t', tok, { iss: 'compass', aud: 'compass-meet' }), null);
  const [, p, s] = tok.split('.');
  const hs512 = `${Buffer.from('{"alg":"HS512"}').toString('base64url')}.${p}.${s}`;
  assert.equal(sec.verifyJwtHS256('s', hs512, {}), null);
});

// ---------- AI 議事録の検証 ----------
const meeting = {
  title: '山田様 打ち合わせ', start: '', createdAt: Date.now(),
  transcript: [{ id: 's1', name: '山田', role: 'guest', text: 'LDKは20帖くらい欲しいです' }, { id: 's2', name: '中谷', role: 'host', text: 'では平屋で進めましょう' }],
  notes: { body: '予算は3500万円', decisions: '', pending: '', todos: '' }, log: [],
};

test('AI の下書き：存在しない発言 ID を出典にした項目は捨てる（作り話を残さない）', () => {
  const draft = {
    overview: '概要',
    requests: { layout: [{ text: 'LDK 20帖', sources: ['s1'] }, { text: '書斎が欲しい', sources: ['s99'] }], design: [], equipment: [], budget: [{ text: '3500万円', sources: ['note'] }], other: [] },
    decisions: [{ text: '平屋で進める', sources: ['s2'] }, { text: '出典なし', sources: [] }],
    pending: [], todos: [{ who: '中谷', what: '見積', due: '11月25日', sources: ['s2'] }], suggestedAgenda: [{ text: '外観の確認' }],
  };
  const v = verify(draft, meeting);
  assert.deepEqual(v.requests.layout.map((x) => x.text), ['LDK 20帖']);
  assert.deepEqual(v.decisions.map((x) => x.text), ['平屋で進める']);
  assert.equal(v.requests.layout[0].needsCheck, true, '寸法（帖）は要確認');
  assert.equal(v.requests.budget[0].needsCheck, true, '金額は要確認');
  assert.equal(v.todos[0].needsCheck, true, '日付は要確認');
  assert.equal(v.suggestedAgenda[0].proposal, true, '次回議題は AI の提案と分かる');
});

test('要確認の判定：金額・寸法・日付・品番', () => {
  for (const s of ['3,500万円', '幅1820mm', '12月3日', '30坪', 'YKK-AP123']) assert.ok(flagRisky(s), s);
  assert.ok(!flagRisky('対面キッチンにしたい'));
});

test('AI への入力：発言は ID 付きで渡し、文字起こしは囲みの中に入れる（指示の混入対策）', () => {
  const s = buildInput(meeting);
  assert.match(s, /\[s1\] 山田（お客様側）：LDKは20帖/);
  assert.match(s, /<transcript>[\s\S]*<\/transcript>/);
});

test('AI 要約：承認の設定がなければ無効。偽の SDK で、拒否・途中切れを扱えることを確かめる', async () => {
  assert.equal(createAi({}).enabled, false);
  assert.equal(createAi({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'x' }).enabled, false, '承認フラグが無ければ無効');
  const fakeClient = (res) => ({ beta: { messages: { stream: (params) => { fakeClient.last = params; return { finalMessage: async () => res }; } } } });
  const ok = createAi({}, null, { client: fakeClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ overview: 'x', requests: { layout: [], design: [], equipment: [], budget: [], other: [] }, decisions: [{ text: '平屋', sources: ['s2'] }], pending: [], todos: [], suggestedAgenda: [] }) }] }) });
  const out = await ok.summarize(meeting);
  assert.equal(out.decisions[0].text, '平屋');
  assert.equal(fakeClient.last.output_config.format.type, 'json_schema');
  assert.equal(fakeClient.last.model, 'claude-opus-5-5');
  const refused = createAi({}, null, { client: fakeClient({ stop_reason: 'refusal', content: [] }) });
  await assert.rejects(refused.summarize(meeting), /断りました/);
  const cut = createAi({}, null, { client: fakeClient({ stop_reason: 'max_tokens', content: [] }) });
  await assert.rejects(cut.summarize(meeting), /途中で切れ/);
});

test('議事録の入力を整える：余計なキーを落とし、長さをそろえる', () => {
  const c = sanitizeMinutes({ overview: 'x'.repeat(5000), decisions: [{ text: 'a', sources: ['s1', 5], hack: true }], requests: {}, todos: [{ what: '' }] });
  assert.equal(c.overview.length, 4000);
  assert.deepEqual(c.decisions, [{ text: 'a', sources: ['s1'], needsCheck: false }]);
  assert.deepEqual(c.todos, []);
  assert.equal(sanitizeMinutes('x'), null);
});
