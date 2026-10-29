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
  closedPeriods: [], // [{from, to, label}] – dager barnehagen er stengt
  priceAlertPct: 5, // varsle når en vare er blitt mer enn så mange % dyrere
  budgetYear: null, // årsbudsjett for forbruksvarer
  budgetIncVat: false, // er budsjettet oppgitt inkl. mva?
};

// ---------- Stengte perioder ----------
// Dager barnehagen er stengt teller ikke som forbruksdager.
const closedCache = new WeakMap();
function closedSet(settings) {
  const periods = settings.closedPeriods || [];
  if (closedCache.has(periods)) return closedCache.get(periods);
  const set = new Set();
  for (const p of periods) {
    if (!p.from || !p.to || p.to < p.from) continue;
    for (let d = p.from, n = 0; d <= p.to && n < 400; d = addDays(d, 1), n++) set.add(d);
  }
  closedCache.set(periods, set);
  return set;
}

// Antall åpne dager etter a til og med b.
export function openDays(a, b, settings) {
  const total = daysBetween(a, b);
  const set = closedSet(settings);
  if (total <= 0 || !set.size) return Math.max(0, total);
  let n = 0;
  for (let i = 1, d = addDays(a, 1); i <= total; i++, d = addDays(d, 1)) if (!set.has(d)) n++;
  return n;
}

// Dato når n åpne dager har gått etter start.
export function addOpenDays(start, n, settings) {
  const set = closedSet(settings);
  if (!set.size) return addDays(start, n);
  let d = start;
  let left = Math.max(0, Math.floor(n));
  for (let guard = 0; left > 0 && guard < 1000; guard++) {
    d = addDays(d, 1);
    if (!set.has(d)) left--;
  }
  return d;
}

export function closedPeriodsBetween(a, b, settings) {
  return (settings.closedPeriods || []).filter((p) => p.from && p.to && p.from <= b && p.to > a);
}

// Varer som tas med i telling og forslag: aktive forbruksvarer (ikke utstyr/engangskjøp).
export const isPlanned = (item) => item.active !== false && item.consumable !== false;

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

// Tellinger og registrerte «gikk tomt» slått sammen til ett tidsforløp.
// En «gikk tomt»-registrering er som en telling med 0, men vi vet datoen lageret tok slutt.
export function stockPoints(state, sku) {
  const counts = countsFor(state, sku).map((c) => ({ ...c, dated: false, kind: 'telling' }));
  const dates = new Set(counts.map((c) => c.date));
  const events = (state.stockouts || [])
    .filter((e) => e.sku === sku && !dates.has(e.date))
    .map((e) => ({ date: e.date, qty: 0, dated: true, kind: 'tomt' }));
  return [...counts, ...events].sort((a, b) => a.date.localeCompare(b.date));
}

export function itemStats(state, sku, today = todayISO()) {
  const s = state.settings;
  const counts = countsFor(state, sku);
  const points = stockPoints(state, sku);
  const arrivals = arrivalsFor(state, sku);
  const fromDate = addDays(today, -s.historyDays);

  // Når lageret var tomt, startet forbruket igjen først da neste levering kom.
  const consumptionStart = (p, until) => {
    if (p.qty > 0) return p.date;
    const a = arrivals.find((x) => x.date > p.date && x.date <= until);
    return a ? addDays(a.date, -1) : null;
  };

  // 1) Forbruk mellom tellinger / tom-registreringer
  const intervals = [];
  for (let i = 1; i < points.length; i++) {
    const c0 = points[i - 1];
    const c1 = points[i];
    if (daysBetween(c0.date, c1.date) <= 0) continue;
    const start = consumptionStart(c0, c1.date);
    if (!start) continue; // tomt hele perioden: vi vet ingenting om forbruket
    const days = openDays(start, c1.date, s);
    if (days <= 0) continue;
    const received = arrivals.filter((a) => a.date > c0.date && a.date <= c1.date).reduce((x, a) => x + a.qty, 0);
    const used = c0.qty + received - c1.qty;
    intervals.push({
      from: c0.date,
      to: c1.date,
      days,
      received,
      used,
      stockout: c1.qty <= 0,
      dated: c1.dated, // vi vet når den gikk tom
      negative: used < 0,
    });
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
      const days = openDays(first, last, s);
      if (days > 0) {
        rate = orders.slice(0, -1).reduce((a, o) => a + o.qty, 0) / days;
        source = 'bestillinger';
      }
    }
    if (rate == null && orders.length >= 1) {
      // Bare én bestilling: fordel mengden over hele perioden vi har ordrer for
      // (minst én bestillingsperiode). Da blir sjeldne kjøp ikke regnet som ukentlig forbruk.
      const firstAny = state.orders.reduce((m, o) => (o.date < m ? o.date : m), orders[0].orderDate);
      const span = Math.max(s.intervalDays, openDays(firstAny, today, s));
      rate = orders.reduce((a, o) => a + o.qty, 0) / span;
      source = 'antatt';
    }
  }

  // Påslag bare når vi vet at varen gikk tom, men ikke når.
  const stockouts = recent.filter((iv) => iv.stockout).length;
  const undated = recent.filter((iv) => iv.stockout && !iv.dated).length;
  const lastPoint = points[points.length - 1] || null;
  const lastUndatedZero = !!lastPoint && lastPoint.qty <= 0 && !lastPoint.dated;
  const boosted = undated > 0 || lastUndatedZero;
  const effRate = rate == null ? null : rate * (boosted ? 1 + s.stockoutBoost / 100 : 1);
  const stockoutEvents = (state.stockouts || []).filter((e) => e.sku === sku).length;

  // Lagerstatus nå
  const lastCount = counts[counts.length - 1] || null;
  let stockNow = null;
  let onTheWay = 0;
  if (lastPoint) {
    const after = arrivals.filter((a) => a.date > lastPoint.date);
    const arrived = after.filter((a) => a.date <= today).reduce((x, a) => x + a.qty, 0);
    onTheWay = after.filter((a) => a.date > today).reduce((x, a) => x + a.qty, 0);
    const start = consumptionStart(lastPoint, today);
    const usedSince = start ? (effRate || 0) * openDays(start, today, s) : 0;
    stockNow = Math.max(0, lastPoint.qty + arrived - usedSince);
  }

  // Dager igjen regnes i åpne dager; bestillingsdatoen tar hensyn til stengte perioder.
  const daysLeft = effRate && stockNow != null ? (stockNow + onTheWay) / effRate : null;
  let orderBy = null;
  if (daysLeft != null) {
    const runsOut = addOpenDays(today, Math.max(0, daysLeft - s.safetyDays), s);
    orderBy = addDays(runsOut, -s.leadDays);
    if (orderBy < today) orderBy = today;
  }

  return {
    sku,
    counts,
    points,
    arrivals,
    intervals,
    rate,
    effRate,
    source,
    stockouts,
    stockoutEvents,
    boosted,
    lastCount,
    lastPoint,
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
export function recommendQty(stats, item, settings, intervalDays = settings.intervalDays, today = todayISO()) {
  const min = item.minQty || 0;
  if (stats.effRate == null) return { qty: min, reason: 'ingen-data' };
  // Bare åpne dager i perioden bestillingen skal dekke, teller.
  const cover = openDays(today, addDays(today, settings.leadDays + intervalDays + settings.safetyDays), settings);
  const target = stats.effRate * cover;
  if (stats.stockNow == null) {
    // Ikke talt: foreslå én periodes forbruk, men marker at varen bør telles.
    const period = openDays(today, addDays(today, intervalDays), settings);
    return { qty: Math.max(min, Math.ceil(stats.effRate * period - 0.15)), reason: 'ikke-talt', target };
  }
  const need = target - stats.stockNow - stats.onTheWay;
  // Liten toleranse så 2,1 ikke blir 3 når det egentlig holder.
  const qty = need > 0.15 ? Math.ceil(need - 0.15) : 0;
  return { qty: Math.max(min, qty), reason: 'beregnet', target };
}

export function buildOrderPlan(state, today = todayISO(), intervalDays = state.settings.intervalDays) {
  const rows = [];
  for (const item of Object.values(state.items)) {
    if (!isPlanned(item)) continue;
    const stats = itemStats(state, item.sku, today);
    const rec = recommendQty(stats, item, state.settings, intervalDays, today);
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
    if (!isPlanned(item)) continue;
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
    if (!isPlanned(item)) continue;
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

// ---------- Prisvarsel ----------
// Sammenligner prisene i en ordre med forrige gang varen ble kjøpt.
export function priceChanges(state, order, minPct = state.settings.priceAlertPct ?? 5) {
  const out = [];
  for (const l of order.lines) {
    let prev = null;
    for (const o of state.orders) {
      if (o.id === order.id || o.date >= order.date) continue;
      const pl = o.lines.find((x) => x.sku === l.sku);
      if (pl && (!prev || o.date > prev.date)) prev = { date: o.date, price: pl.price };
    }
    if (!prev || !prev.price) continue;
    const pct = ((l.price - prev.price) / prev.price) * 100;
    if (Math.abs(pct) >= minPct) out.push({ sku: l.sku, name: l.name, prev: prev.price, prevDate: prev.date, now: l.price, pct });
  }
  return out.sort((a, b) => b.pct - a.pct);
}

// ---------- Budsjett ----------
const lineInc = (l) => (l.sumInc != null ? l.sumInc : l.sum * 1.25);
export function spendInYear(state, year) {
  let ex = 0;
  let inc = 0;
  for (const o of state.orders) {
    if (!o.date.startsWith(String(year))) continue;
    for (const l of o.lines) {
      ex += l.sum;
      inc += lineInc(l);
    }
  }
  return { ex, inc };
}

export function budgetStatus(state, today = todayISO()) {
  const s = state.settings;
  if (!s.budgetYear) return null;
  const year = today.slice(0, 4);
  const sp = spendInYear(state, year);
  const spent = s.budgetIncVat ? sp.inc : sp.ex;
  const dayOfYear = daysBetween(`${year}-01-01`, today) + 1;
  const daysInYear = daysBetween(`${year}-01-01`, `${Number(year) + 1}-01-01`);
  // Forventet årsforbruk: snitt per dag hittil i år. Tidlig på året er anslaget usikkert.
  const projected = dayOfYear >= 30 ? (spent / dayOfYear) * daysInYear : null;
  const month = today.slice(0, 7);
  let monthSpent = 0;
  for (const o of state.orders) {
    if (!o.date.startsWith(month)) continue;
    for (const l of o.lines) monthSpent += s.budgetIncVat ? lineInc(l) : l.sum;
  }
  return {
    year,
    budget: s.budgetYear,
    incVat: !!s.budgetIncVat,
    spent,
    left: s.budgetYear - spent,
    pct: (spent / s.budgetYear) * 100,
    yearPct: (dayOfYear / daysInYear) * 100,
    projected,
    monthBudget: s.budgetYear / 12,
    monthSpent,
  };
}

// ---------- Kategorier ----------
export function spendByCategory(state, year) {
  const map = new Map();
  for (const o of state.orders) {
    if (year && !o.date.startsWith(String(year))) continue;
    for (const l of o.lines) {
      const cat = state.items[l.sku]?.category || 'Annet';
      map.set(cat, (map.get(cat) || 0) + l.sum);
    }
  }
  return [...map.entries()].map(([category, sum]) => ({ category, sum })).sort((a, b) => b.sum - a.sum);
}
