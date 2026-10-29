import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemStats, recommendQty, buildOrderPlan, nextOrderSuggestion, frequencyOptions, DEFAULT_SETTINGS, openDays, addOpenDays, priceChanges, budgetStatus, spendByCategory } from '../js/calc.js';
import { guessCategory } from '../js/categories.js';

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
  // Tomt ved forrige telling: forbruket starter når leveransen kom (03.10), dvs. 20 dager.
  assert.ok(Math.abs(st.effRate - (4 / 20) * 1.25) < 1e-9);
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

test('«gikk tomt» med dato gir riktig forbruk uten påslag', () => {
  // Telling 01.10: 1. Levert 4 den 03.10. Tomt 15.10 → 5 brukt på 14 dager.
  const s = base({
    orders: [order('a', '2026-10-01', 4)],
    counts: [{ date: '2026-10-01', entries: { 1: 1 } }],
    stockouts: [{ sku: '1', date: '2026-10-15' }],
  });
  const st = itemStats(s, '1', '2026-10-20');
  assert.equal(st.source, 'telling');
  assert.ok(Math.abs(st.rate - 5 / 14) < 1e-9);
  assert.equal(st.boosted, false);
  assert.equal(st.stockNow, 0);
  assert.equal(st.orderBy, '2026-10-20'); // tomt nå → bestill i dag
});

test('perioden etter «gikk tomt» måles fra neste levering', () => {
  const s = base({
    orders: [order('a', '2026-10-01', 4), order('b', '2026-10-20', 6)], // leveres 03.10 og 22.10
    counts: [{ date: '2026-10-01', entries: { 1: 1 } }, { date: '2026-11-05', entries: { 1: 3 } }],
    stockouts: [{ sku: '1', date: '2026-10-15' }],
  });
  const st = itemStats(s, '1', '2026-11-05');
  // 01.10–15.10: 5 på 14 dager. 21.10–05.11: 6−3 = 3 på 15 dager.
  assert.equal(st.intervals.length, 2);
  assert.equal(st.intervals[1].days, 15);
  assert.ok(Math.abs(st.rate - 8 / 29) < 1e-9);
});

test('stengte dager teller ikke', () => {
  const settings = { ...DEFAULT_SETTINGS, closedPeriods: [{ from: '2026-07-01', to: '2026-07-31', label: 'Sommer' }] };
  assert.equal(openDays('2026-06-20', '2026-08-10', settings), 51 - 31);
  assert.equal(addOpenDays('2026-06-29', 3, settings), '2026-08-02');
  // Forbruk målt over sommeren blir ikke lavt
  const s = base({ settings, orders: [order('a', '2026-06-25', 4)], counts: [{ date: '2026-06-25', entries: { 1: 2 } }, { date: '2026-08-10', entries: { 1: 2 } }] });
  const st = itemStats(s, '1', '2026-08-10');
  assert.equal(st.intervals[0].days, 46 - 31);
  // Forslag rett før ferien dekker bare åpne dager
  const rec = recommendQty({ effRate: 1, stockNow: 0, onTheWay: 0 }, item, settings, 21, '2026-06-24');
  assert.equal(rec.qty, 6); // 27 dager frem (til 21.07): 6 åpne dager i juni, 21 stengte i juli
});

test('prisvarsel ved prisøkning', () => {
  const s = base({ orders: [order('a', '2026-09-01', 1, 100), order('b', '2026-10-01', 1, 112)] });
  const ch = priceChanges(s, s.orders[1]);
  assert.equal(ch.length, 1);
  assert.ok(Math.abs(ch[0].pct - 12) < 1e-9);
  assert.equal(priceChanges(s, s.orders[1], 15).length, 0);
});

test('budsjett og kategorier', () => {
  const s = base({ orders: [order('a', '2026-02-01', 10, 100), order('b', '2026-06-01', 10, 100)] });
  s.settings.budgetYear = 4000;
  s.items[1].category = 'Tørkepapir og toalett';
  const b = budgetStatus(s, '2026-07-01');
  assert.equal(b.spent, 2000);
  assert.equal(b.pct, 50);
  assert.ok(b.projected > 3900 && b.projected < 4100);
  s.settings.budgetIncVat = true;
  assert.equal(budgetStatus(s, '2026-07-01').spent, 2500);
  assert.deepEqual(spendByCategory(s, 2026), [{ category: 'Tørkepapir og toalett', sum: 2000 }]);
  assert.equal(guessCategory('Håndtørk H5 Tork PeakServe Universal 1l'), 'Tørkepapir og toalett');
  assert.equal(guessCategory('Våtserviett Abena u/parf lokk 18x20cm'), 'Hygiene');
  assert.equal(guessCategory('Avfallspose 60x90cm 50L 8my Hvit'), 'Renhold');
  assert.equal(guessCategory('Kopipapir MultiLaser A4 80g'), 'Kontor');
  assert.equal(guessCategory('Noe helt annet'), 'Annet');
});
