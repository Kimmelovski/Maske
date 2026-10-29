import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemStats, recommendQty, buildOrderPlan, nextOrderSuggestion, frequencyOptions, DEFAULT_SETTINGS } from '../js/calc.js';

const item = { sku: '1', name: 'Tørkepapir', unit: 'kartong', minQty: 0, active: true };
const order = (id, date, qty, price = 100, receivedDate = null) => ({ id, date, receivedDate, lines: [{ sku: '1', name: 'Tørkepapir', price, qty, sum: price * qty }] });
const base = (extra) => ({ items: { 1: item }, orders: [], counts: [], draft: {}, settings: { ...DEFAULT_SETTINGS }, ...extra });

test('forbruk fra tellinger: forrige + mottatt − ny', () => {
  // Telling 01.10: 1. Bestilt 01.10 (4 stk, levert 03.10). Telling 22.10: 2 → brukt 3 på 21 dager.
  const s = base({ orders: [order('a', '2026-10-01', 4)], counts: [{ date: '2026-10-01', entries: { 1: 1 } }, { date: '2026-10-22', entries: { 1: 2 } }] });
  const st = itemStats(s, '1', '2026-10-22');
  assert.equal(st.source, 'telling');
  assert.equal(st.intervals[0].received, 4);
  assert.equal(st.intervals[0].used, 3);
  assert.ok(Math.abs(st.rate - 3 / 21) < 1e-9);
  assert.equal(st.boosted, false);
  assert.equal(st.stockNow, 2);
});

test('påslag når varen har gått tom', () => {
  const s = base({ orders: [order('a', '2026-10-01', 4)], counts: [{ date: '2026-10-01', entries: { 1: 0 } }, { date: '2026-10-22', entries: { 1: 0 } }] });
  const st = itemStats(s, '1', '2026-10-22');
  assert.equal(st.boosted, true);
  assert.ok(Math.abs(st.effRate - (4 / 21) * 1.25) < 1e-9);
});

test('anbefalt antall dekker leveringstid + periode + buffer minus lager', () => {
  const s = base({ orders: [order('a', '2026-10-01', 4)], counts: [{ date: '2026-10-01', entries: { 1: 1 } }, { date: '2026-10-22', entries: { 1: 2 } }] });
  const st = itemStats(s, '1', '2026-10-22');
  const rec = recommendQty(st, item, s.settings);
  // (2+21+4) dager × 3/21 = 3,857 − 2 på lager = 1,857 → 2
  assert.equal(rec.qty, 2);
  assert.equal(recommendQty(st, item, s.settings, 42).qty, 5); // 48×3/21=6,86−2=4,86 → 5
});

test('uten tellinger brukes bestillingshistorikken', () => {
  const s = base({ orders: [order('a', '2026-09-01', 3), order('b', '2026-09-22', 3), order('c', '2026-10-13', 3)] });
  const st = itemStats(s, '1', '2026-10-20');
  assert.equal(st.source, 'bestillinger');
  assert.ok(Math.abs(st.rate - 6 / 42) < 1e-9);
  assert.equal(st.stockNow, null);
  assert.equal(recommendQty(st, item, s.settings).reason, 'ikke-talt');
});

test('justering i utkast overstyrer forslaget', () => {
  const s = base({ orders: [order('a', '2026-10-01', 4)], draft: { 1: 7 } });
  const plan = buildOrderPlan(s, '2026-10-02');
  assert.equal(plan.rows[0].qty, 7);
  assert.equal(plan.rows[0].adjusted, true);
  assert.equal(plan.total, 700);
});

test('neste bestilling og frekvensforslag', () => {
  const s = base({ orders: [order('a', '2026-10-01', 4)], counts: [{ date: '2026-10-01', entries: { 1: 1 } }, { date: '2026-10-22', entries: { 1: 2 } }] });
  const n = nextOrderSuggestion(s, '2026-10-22');
  // 2 kartonger / (3/21 per dag) = 14 dager − 2 − 4 = 8
  assert.equal(n.date, '2026-10-30');
  s.settings.freeShippingMin = 250;
  const f = frequencyOptions(s, '2026-10-22');
  assert.equal(f.recommended, 21); // 100×3/21×14 = 200 < 250, ×21 = 300 ≥ 250
  assert.equal(f.why, 'freeShipping');
});

test('engangskjøp fordeles over hele ordrehistorikken, utstyr holdes utenfor', () => {
  const pedal = { sku: '2', name: 'Pedalbøtte', unit: 'stk', active: true };
  const s = base({
    items: { 1: item, 2: pedal },
    orders: [
      order('a', '2026-09-01', 3),
      { id: 'b', date: '2026-09-22', receivedDate: null, lines: [{ sku: '2', name: 'Pedalbøtte', price: 800, qty: 1, sum: 800 }] },
      order('c', '2026-10-27', 3),
    ],
  });
  const st = itemStats(s, '2', '2026-10-29');
  assert.equal(st.source, 'antatt');
  assert.ok(Math.abs(st.rate - 1 / 58) < 1e-9); // 01.09–29.10 = 58 dager, ikke 21
  const withPedal = frequencyOptions(s, '2026-10-29').daily;
  s.items[2].consumable = false;
  const without = frequencyOptions(s, '2026-10-29').daily;
  assert.ok(without < withPedal);
  assert.equal(buildOrderPlan(s, '2026-10-29').rows.some((r) => r.item.sku === '2'), false);
});
