// レジ締め：開店時の釣銭準備金 → 入出金 → 点検 → 金種を数えて精算（過不足を出す）
export const DENOMINATIONS = [10000, 5000, 2000, 1000, 500, 100, 50, 10, 5, 1];

// 期間中の支払い・入出金から理論上の現金在高を出す（純粋関数・テスト対象）
//  session: { openedAt, float, movements: [{type:'in'|'out', amount}] }
//  checks:  会計済み・営業中の伝票（payments を持つ）
export function registerSummary(session, checks) {
  const since = session.openedAt;
  const byMethod = {};
  let salesChecks = 0;
  let guests = 0;
  let sales = 0;
  for (const c of checks) {
    for (const p of c.payments || []) {
      if (p.at < since) continue;
      const m = byMethod[p.method] ||= { amount: 0, count: 0 };
      m.amount += p.amount;
      m.count += 1;
    }
    if (c.status === 'closed' && c.closedAt >= since) {
      salesChecks += 1;
      guests += c.people || 1;
      sales += c.totals?.total ?? 0;
    }
  }
  const cashSales = byMethod['現金']?.amount || 0;
  const moneyIn = (session.movements || []).filter((m) => m.type === 'in').reduce((s, m) => s + m.amount, 0);
  const moneyOut = (session.movements || []).filter((m) => m.type === 'out').reduce((s, m) => s + m.amount, 0);
  return {
    float: session.float, cashSales, moneyIn, moneyOut, expectedCash: session.float + cashSales + moneyIn - moneyOut,
    byMethod, salesChecks, guests, sales,
  };
}

export function countTotal(counts = {}) {
  return DENOMINATIONS.reduce((s, d) => s + d * (Math.max(0, Math.floor(Number(counts[d]) || 0))), 0);
}

function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function installRegister(f) {
  const { route, S, store, ctx, now, fail, str, int, newId, notifyAdmin, emit } = f;
  const R = () => (S().register ||= { session: null, log: [], lastFloat: 30000 });

  // セッション中に関係する伝票（会計済みの履歴＋営業中）
  function checksSince(session) {
    const out = [...S().openChecks];
    const end = ctx().bizDate;
    for (let d = session.openedBizDate, i = 0; d <= end && i < 40; d = addDays(d, 1), i++) out.push(...store.getHistory(d));
    return out;
  }
  const summary = (session) => registerSummary(session, checksSince(session));
  const save = () => { store.save(); notifyAdmin('register'); };

  route('GET', '/api/admin/register', () => {
    const r = R();
    return { session: r.session, summary: r.session ? summary(r.session) : null, log: r.log.slice(-60).reverse(), lastFloat: r.lastFloat };
  });

  route('POST', '/api/admin/register/open', ({ body }) => {
    const r = R();
    if (r.session) fail(409, 'レジはすでに開いています');
    const float = Math.max(0, int(body.float));
    r.session = { id: newId('reg_'), openedAt: now().toISOString(), openedBizDate: ctx().bizDate, float, movements: [] };
    r.lastFloat = float;
    save();
    emit('register-open', { session: r.session });
    return { ok: true, session: r.session };
  });

  route('POST', '/api/admin/register/movements', ({ body }) => {
    const r = R();
    if (!r.session) fail(409, '先にレジを開けてください');
    const amount = int(body.amount);
    if (amount <= 0) fail(400, '金額を入力してください');
    const m = { id: newId('mv_'), type: body.type === 'out' ? 'out' : 'in', amount, reason: str(body.reason, 60), at: now().toISOString() };
    r.session.movements.push(m);
    save();
    emit('drawer', {});
    return { ok: true, movement: m };
  });

  route('DELETE', '/api/admin/register/movements/:id', ({ params }) => {
    const r = R();
    if (!r.session) fail(409, 'レジが開いていません');
    r.session.movements = r.session.movements.filter((m) => m.id !== params.id);
    save();
    return { ok: true };
  });

  route('POST', '/api/admin/register/close', ({ body }) => {
    const r = R();
    if (!r.session) fail(409, 'レジが開いていません');
    const counts = Object.fromEntries(DENOMINATIONS.map((d) => [d, Math.max(0, int(body.counts?.[d]))]));
    const sum = summary(r.session);
    const actual = countTotal(counts);
    const entry = {
      ...r.session, closedAt: now().toISOString(), closedBizDate: ctx().bizDate, counts, actual,
      difference: actual - sum.expectedCash, note: str(body.note, 200), summary: sum,
    };
    r.log.push(entry);
    if (r.log.length > 400) r.log.splice(0, r.log.length - 400);
    r.session = null;
    save();
    emit('register-close', { entry });
    return { ok: true, entry };
  });

  route('GET', '/api/admin/register/log/:id', ({ params }) => R().log.find((x) => x.id === params.id) || fail(404, '記録が見つかりません'));

  return {
    state: () => ({ registerOpen: !!R().session }),
    summary,
    current: () => R().session,
  };
}
