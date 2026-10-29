// Beregning av forbruk, lagerstatus og anbefalt bestilling.
//
// Grunnidé: du teller lageret før hver bestilling. Mellom to tellinger er
//   forbruk = forrige telling + det som kom inn − ny telling
// Forbruk per dag gir oss hvor lenge lageret varer og hvor mye som bør bestilles.
// Alle mengder er i varens bestillingsenhet (f.eks. kartong), desimaler er lov.

import { addDays, daysBetween, todayISO } from './util.js';

export const DEFAULT_SETTINGS = {
  leadDays: 2, // dager fra bestilling til varene er levert
  intervalDays: 21, // hvor ofte dere bestiller
  safetyDays: 4, // ekstra buffer i dager
  stockoutBoost: 25, // % påslag på forbruket for varer som har gått tomme
  historyDays: 365, // hvor langt tilbake forbruket beregnes fra
  freeShippingMin: null, // beløp eks. mva for fri frakt (hvis kjent)
  showVat: false, // vis beløp inkl. mva
  lastBackup: null,
};

export function arrivalDate(order, settings) {
  return order.receivedDate || addDays(order.date, settings.leadDays);
}

// Alle leveranser av en vare: [{date, qty, orderDate}]
export function arrivalsFor(state, sku) {
  const out = [];
  for (const o of state.orders) {
    const qty = o.lines.filter((l) => l.sku === sku).reduce((a, l) => a + l.qty, 0);
    if (qty) out.push({ date: arrivalDate(o, state.settings), orderDate: o.date, qty });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export function countsFor(state, sku) {
  return state.counts
    .filter((c) => c.entries[sku] != null && !Number.isNaN(c.entries[sku]))
    .map((c) => ({ date: c.date, qty: c.entries[sku] }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function itemStats(state, sku, today = todayISO()) {
  const s = state.settings;
  const counts = countsFor(state, sku);
  const arrivals = arrivalsFor(state, sku);
  const fromDate = addDays(today, -s.historyDays);

  // 1) Forbruk fra tellinger
  const intervals = [];
  for (let i = 1; i < counts.length; i++) {
    const c0 = counts[i - 1];
    const c1 = counts[i];
    const days = daysBetween(c0.date, c1.date);
    if (days <= 0) continue;
    const received = arrivals.filter((a) => a.date > c0.date && a.date <= c1.date).reduce((x, a) => x + a.qty, 0);
    const used = c0.qty + received - c1.qty;
    intervals.push({ from: c0.date, to: c1.date, days, received, used, stockout: c1.qty <= 0, negative: used < 0 });
  }
  const recent = intervals.filter((iv) => iv.to >= fromDate && !iv.negative);
  let rate = null;
  let source = null;
  if (recent.length) {
    const days = recent.reduce((a, iv) => a + iv.days, 0);
    rate = recent.reduce((a, iv) => a + iv.used, 0) / days;
    source = 'telling';
  } else {
    // 2) Reserve: anslag fra bestillingshistorikken
    const orders = arrivals.filter((a) => a.orderDate >= fromDate);
    if (orders.length >= 2) {
      const first = orders[0].orderDate;
      const last = orders[orders.length - 1].orderDate;
      const days = daysBetween(first, last);
      if (days > 0) {
        rate = orders.slice(0, -1).reduce((a, o) => a + o.qty, 0) / days;
        source = 'bestillinger';
      }
    }
    if (rate == null && orders.length >= 1) {
      // Én bestilling: anta at den var ment å vare én bestillingsperiode.
      rate = orders.reduce((a, o) => a + o.qty, 0) / orders.length / s.intervalDays;
      source = 'antatt';
    }
  }

  const stockouts = recent.filter((iv) => iv.stockout).length;
  const lastCountZero = counts.length > 0 && counts[counts.length - 1].qty <= 0;
  const boosted = stockouts > 0 || lastCountZero;
  const effRate = rate == null ? null : rate * (boosted ? 1 + s.stockoutBoost / 100 : 1);

  // Lagerstatus nå
  const lastCount = counts[counts.length - 1] || null;
  let stockNow = null;
  let onTheWay = 0;
  if (lastCount) {
    const after = arrivals.filter((a) => a.date > lastCount.date);
    const arrived = after.filter((a) => a.date <= today).reduce((x, a) => x + a.qty, 0);
    onTheWay = after.filter((a) => a.date > today).reduce((x, a) => x + a.qty, 0);
    const usedSince = (effRate || 0) * Math.max(0, daysBetween(lastCount.date, today));
    stockNow = Math.max(0, lastCount.qty + arrived - usedSince);
  }

  const daysLeft = effRate && stockNow != null ? (stockNow + onTheWay) / effRate : null;
  const orderBy =
    daysLeft == null ? null : addDays(today, Math.max(0, Math.floor(daysLeft - s.leadDays - s.safetyDays)));

  return {
    sku,
    counts,
    arrivals,
    intervals,
    rate,
    effRate,
    source,
    stockouts,
    boosted,
    lastCount,
    stockNow,
    onTheWay,
    daysLeft,
    orderBy,
    anomalies: intervals.filter((iv) => iv.negative).length,
  };
}

export function lastPrice(state, sku) {
  let best = null;
  for (const o of state.orders) {
    for (const l of o.lines) {
      if (l.sku === sku && (!best || o.date >= best.date)) best = { date: o.date, price: l.price };
    }
  }
  return best ? best.price : null;
}

export function priceHistory(state, sku) {
  const pts = [];
  for (const o of state.orders) {
    const l = o.lines.find((x) => x.sku === sku);
    if (l) pts.push({ date: o.date, price: l.price, qty: l.qty, orderId: o.id });
  }
  return pts.sort((a, b) => a.date.localeCompare(b.date));
}

// Anbefalt antall for én vare ved en gitt bestillingsrytme.
export function recommendQty(stats, item, settings, intervalDays = settings.intervalDays) {
  const min = item.minQty || 0;
  if (stats.effRate == null) return { qty: min, reason: 'ingen-data' };
  const cover = settings.leadDays + intervalDays + settings.safetyDays;
  const target = stats.effRate * cover;
  if (stats.stockNow == null) {
    // Ikke talt: foreslå én periodes forbruk, men marker at varen bør telles.
    return { qty: Math.max(min, Math.ceil(stats.effRate * intervalDays - 0.15)), reason: 'ikke-talt', target };
  }
  const need = target - stats.stockNow - stats.onTheWay;
  // Liten toleranse så 2,1 ikke blir 3 når det egentlig holder.
  const qty = need > 0.15 ? Math.ceil(need - 0.15) : 0;
  return { qty: Math.max(min, qty), reason: 'beregnet', target };
}

export function buildOrderPlan(state, today = todayISO(), intervalDays = state.settings.intervalDays) {
  const rows = [];
  for (const item of Object.values(state.items)) {
    if (item.active === false) continue;
    const stats = itemStats(state, item.sku, today);
    const rec = recommendQty(stats, item, state.settings, intervalDays);
    const override = state.draft?.[item.sku];
    const qty = override != null ? override : rec.qty;
    const price = lastPrice(state, item.sku);
    rows.push({ item, stats, rec, qty, adjusted: override != null, price, cost: price != null ? price * qty : 0 });
  }
  rows.sort((a, b) => (b.qty > 0) - (a.qty > 0) || a.item.name.localeCompare(b.item.name, 'nb'));
  const total = rows.reduce((a, r) => a + r.cost, 0);
  return { rows, total };
}

// Når bør neste bestilling skje? Den første varen som når bufferen bestemmer.
export function nextOrderSuggestion(state, today = todayISO()) {
  let first = null;
  let urgent = [];
  for (const item of Object.values(state.items)) {
    if (item.active === false) continue;
    const st = itemStats(state, item.sku, today);
    if (!st.orderBy) continue;
    if (!first || st.orderBy < first.date) first = { date: st.orderBy, item };
    if (st.orderBy <= today) urgent.push(item);
  }
  if (first) return { date: first.date, item: first.item, urgent, basis: 'telling' };
  const last = [...state.orders].sort((a, b) => b.date.localeCompare(a.date))[0];
  if (last) return { date: addDays(last.date, state.settings.intervalDays), item: null, urgent, basis: 'rytme' };
  return null;
}

// Hva koster en bestilling ved ulike intervaller, og hvilket intervall passer?
export function frequencyOptions(state, today = todayISO()) {
  let daily = 0;
  let known = 0;
  for (const item of Object.values(state.items)) {
    if (item.active === false) continue;
    const st = itemStats(state, item.sku, today);
    const p = lastPrice(state, item.sku);
    if (st.effRate && p != null) {
      daily += st.effRate * p;
      known++;
    }
  }
  const options = [7, 14, 21, 28, 42].map((d) => ({ days: d, value: daily * d }));
  const min = state.settings.freeShippingMin;
  let recommended = state.settings.intervalDays;
  let why = 'current';
  if (min && daily > 0) {
    const ok = options.find((o) => o.value >= min);
    if (ok) {
      recommended = ok.days;
      why = 'freeShipping';
    }
  }
  return { daily, known, options, recommended, why };
}

// Faktisk snittintervall mellom bestillinger.
export function averageOrderInterval(state) {
  const dates = [...new Set(state.orders.map((o) => o.date))].sort();
  if (dates.length < 2) return null;
  return daysBetween(dates[0], dates[dates.length - 1]) / (dates.length - 1);
}

export function monthlySpend(state) {
  const map = new Map();
  for (const o of state.orders) {
    const ym = o.date.slice(0, 7);
    const sum = o.lines.reduce((a, l) => a + l.sum, 0);
    map.set(ym, (map.get(ym) || 0) + sum);
  }
  return map;
}
