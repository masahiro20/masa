import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedData, defaultSettings } from '../lib/seed.js';
import { priceLine } from '../public/shared/calc.js';

test('お店の初期メニューに矛盾がない', () => {
  const { categories, items } = seedData();
  const catIds = new Set(categories.map((c) => c.id));
  assert.equal(new Set(items.map((i) => i.id)).size, items.length, '商品IDが重複していない');
  for (const item of items) {
    assert.ok(catIds.has(item.categoryId), `${item.name} のカテゴリがある`);
    // 必須の項目で先頭から選べば注文できる
    const sel = {};
    for (const g of item.optionGroups || []) {
      if (g.required) sel[g.id] = g.choices.slice(0, g.min || 1).map((c) => c.id);
    }
    const r = priceLine(item, sel);
    assert.ok(r.ok, `${item.name}: ${r.error}`);
    assert.ok(r.unitPrice > 0, `${item.name} の値段が0円以下になっていない`);
  }
  assert.ok(defaultSettings().paymentMethods.includes('現金'));
});
