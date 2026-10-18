import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  businessContext, itemStatus, priceLine, computeTotals, lineNetAmounts, splitEqual, splitByItems,
} from '../public/shared/calc.js';

const line = (id, unitPrice, qty = 1, extra = {}) => ({ id, unitPrice, qty, status: 'new', ...extra });
const check = (lines, extra = {}) => ({ orders: [{ lines }], payments: [], discounts: [], tickets: 0, ...extra });
const settings = { ticket: { value: 500 }, taxRate: 10, takeoutTaxRate: 8 };

test('営業日は日本時間・切替時刻で判定する', () => {
  // UTC 2026-10-18 17:30 = JST 10/19 02:30 → 4時切替なので営業日は 10/18
  const c = businessContext(new Date('2026-10-18T17:30:00Z'), 'Asia/Tokyo', 4);
  assert.equal(c.bizDate, '2026-10-18');
  assert.equal(c.hhmm, '02:30');
  assert.equal(c.dow, 0); // 日曜の営業日扱い
  assert.equal(businessContext(new Date('2026-10-18T23:00:00Z'), 'Asia/Tokyo', 4).bizDate, '2026-10-19');
});

test('提供時間・曜日・売り切れ・残数', () => {
  const ctx = { bizDate: '2026-10-19', dow: 1, hhmm: '12:00' };
  assert.equal(itemStatus({ availability: { from: '07:00', to: '11:00' } }, ctx).orderable, false);
  assert.equal(itemStatus({ availability: { from: '07:00', to: '11:00' } }, ctx, { staff: true }).orderable, true);
  assert.equal(itemStatus({ availability: { days: [6, 0] } }, ctx).show, false);
  assert.equal(itemStatus({ soldOutDate: '2026-10-19' }, ctx).reason, '売り切れ');
  assert.equal(itemStatus({ soldOutDate: '2026-10-18' }, ctx).orderable, true, '前日の売り切れは自動で解除');
  assert.equal(itemStatus({ stock: { date: '2026-10-19', qty: 0 } }, ctx).orderable, false);
  assert.equal(itemStatus({ customerVisible: false }, ctx).show, false);
  assert.equal(itemStatus({ offDate: '2026-10-19' }, ctx).show, false);
});

test('オプション価格と必須チェック', () => {
  const item = {
    price: 550,
    optionGroups: [
      { id: 'f', name: 'フレーバー', type: 'single', required: true, choices: [
        { id: 'plain', label: 'プレーン', price: 0 }, { id: 'l1', label: '期間限定①', detail: '栗', price: 50 },
        { id: 'l2', label: '期間限定②', price: 50, soldOutDate: '2026-10-19' },
      ] },
      { id: 'set', name: 'ドリンクセット', type: 'single', required: false, choices: [{ id: 'b', label: 'ブレンド', price: 300 }] },
    ],
  };
  assert.equal(priceLine(item, {}).ok, false);
  const r = priceLine(item, { f: ['l1'], set: ['b'] }, '2026-10-19');
  assert.equal(r.unitPrice, 900);
  assert.equal(r.options[0].label, '期間限定① 栗');
  assert.equal(priceLine(item, { f: ['l2'] }, '2026-10-19').ok, false);
  assert.equal(priceLine(item, { f: ['plain', 'l1'] }).ok, false);
});

test('コーヒーチケット：対象商品から値引き、差額はお客様負担', () => {
  const c = check([
    line('a', 500, 1, { ticketEligible: true }), // ブレンド
    line('b', 650, 1, { ticketEligible: true }), // ラテ+オーツ
    line('c', 550, 1), // ケーキ（対象外）
  ], { tickets: 5 });
  const t = computeTotals(c, settings);
  assert.equal(t.ticketMax, 2);
  assert.equal(t.tickets, 2, '対象の数より多くは使えない');
  assert.equal(t.ticketDiscount, 1000);
  assert.equal(t.total, 700); // 150差額 + 550
});

test('割引・内税・残額', () => {
  const c = check([line('a', 1000, 2)], { discounts: [{ type: 'percent', value: 10 }, { type: 'amount', value: 100 }], payments: [{ amount: 500 }] });
  const t = computeTotals(c, settings);
  assert.equal(t.discountTotal, 300);
  assert.equal(t.total, 1700);
  assert.equal(t.tax, 154);
  assert.equal(t.remaining, 1200);
  assert.equal(computeTotals({ ...c, takeout: true }, settings).tax, 125);
});

test('取消・サービスは合計に含めない', () => {
  const c = check([line('a', 500), line('b', 500, 1, { status: 'cancelled' }), line('c', 500, 1, { comp: true })]);
  assert.equal(computeTotals(c, settings).total, 500);
});

test('均等割り', () => {
  assert.deepEqual(splitEqual(1234, 3), [412, 411, 411]);
  assert.deepEqual(splitEqual(3250, 3, 100), [1250, 1000, 1000]);
  assert.equal(splitEqual(999, 4, 10).reduce((a, b) => a + b), 999);
});

test('個別会計：割引を按分しても合計が一致する', () => {
  const c = check([
    line('a', 500, 1, { ticketEligible: true }),
    line('b', 1300),
    line('c', 550),
    line('d', 700),
  ], { tickets: 1, discounts: [{ type: 'percent', value: 10 }] });
  const t = computeTotals(c, settings);
  const net = lineNetAmounts(c, settings);
  assert.equal(Object.values(net).reduce((a, b) => a + b), t.total);
  assert.equal(net.a, 0);
  const r = splitByItems(c, settings, ['A', 'B'], { a: ['A'], b: ['A'], c: ['A', 'B'], d: ['B'] });
  assert.equal(r.people.A + r.people.B + r.unassigned, t.total);
  assert.equal(r.unassigned, 0);
});
