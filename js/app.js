import { load, save, requestPersist, mergeState, normalize, emptyState } from './db.js';
import { parseMaskeOrder } from './parser.js';
import {
  itemStats,
  buildOrderPlan,
  nextOrderSuggestion,
  frequencyOptions,
  averageOrderInterval,
  monthlySpend,
  priceHistory,
  lastPrice,
  isPlanned,
  priceChanges,
  budgetStatus,
  spendByCategory,
  closedPeriodsBetween,
} from './calc.js';
import { CATEGORIES, guessCategory } from './categories.js';
import { barChart, lineChart } from './charts.js';
import { esc, fmtDate, fmtKr, fmtNum, todayISO, daysBetween, monthLabel, parseInput, addDays, round2 } from './util.js';

let state = emptyState();
const ui = { countDate: todayISO(), stockoutDate: todayISO(), preview: null, pasteText: '', importMsg: '' };
const $main = () => document.getElementById('main');

// ---------- Hjelpere ----------
const vatF = () => (state.settings.showVat ? 1.25 : 1);
const money = (x, dec = 0) => fmtKr(x == null ? null : x * vatF(), dec);
const vatLabel = () => (state.settings.showVat ? 'inkl. mva' : 'eks. mva');
const unitOf = (item) => item.unit || 'stk';
const perWeek = (r) => (r == null ? null : r * 7);

function persist() {
  save(state).catch((e) => toast('Kunne ikke lagre: ' + e.message));
}
function commit() {
  persist();
  render();
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), 2600);
}

function qtyText(item, q) {
  if (q == null) return '–';
  const u = unitOf(item);
  if (item.perUnit && item.subUnit) {
    const whole = Math.floor(q + 1e-9);
    const rest = Math.round((q - whole) * item.perUnit);
    if (rest && whole) return `${whole} ${u} + ${rest} ${item.subUnit}`;
    if (rest) return `${rest} ${item.subUnit}`;
    return `${whole} ${u}`;
  }
  return `${fmtNum(q, 1)} ${u}`;
}

function sourceBadge(st) {
  if (st.source === 'telling') return '';
  if (st.source === 'bestillinger') return '<span class="badge muted">anslag fra bestillinger</span>';
  if (st.source === 'antatt') return '<span class="badge muted">grovt anslag</span>';
  return '';
}

function newItem(sku, name) {
  return { sku, name, unit: 'stk', perUnit: null, subUnit: '', minQty: 0, active: true, note: '', category: guessCategory(name) };
}

function ensureItemsFromOrder(order) {
  for (const l of order.lines) {
    if (!state.items[l.sku]) state.items[l.sku] = newItem(l.sku, l.name);
  }
}

// Gir varer uten kategori en foreslått kategori (gjelder varer lagt inn før kategorier fantes).
function migrateItems() {
  for (const it of Object.values(state.items)) if (!it.category) it.category = guessCategory(it.name);
}

const catIndex = (c) => {
  const i = CATEGORIES.indexOf(c || 'Annet');
  return i < 0 ? CATEGORIES.length : i;
};
const byCategoryThenName = (a, b) => catIndex(a.category) - catIndex(b.category) || a.name.localeCompare(b.name, 'nb');

// Legger inn kategorioverskrifter i en sortert liste.
function withCategoryHeaders(items, rowFn, headerFn) {
  let last = null;
  return items
    .map((it) => {
      const cat = it.category || 'Annet';
      const head = cat !== last ? headerFn(cat) : '';
      last = cat;
      return head + rowFn(it);
    })
    .join('');
}

function priceChangeList(changes) {
  if (!changes.length) return '';
  return `<ul class="list">${changes
    .map(
      (c) => `<li><button class="link" data-act="go" data-to="#/vare/${esc(c.sku)}">${esc(c.name)}<span class="muted small">${money(c.prev, 2)} (${fmtDate(c.prevDate)}) → ${money(c.now, 2)}</span></button><span class="num ${c.pct > 0 ? 'danger' : 'ok'}">${c.pct > 0 ? '▲ +' : '▼ '}${fmtNum(c.pct, 1)} %</span></li>`
    )
    .join('')}</ul>`;
}

// ---------- Visninger ----------
const views = {
  home() {
    const hasData = state.orders.length > 0;
    if (!hasData) {
      return `
        <h1>Velkommen 👋</h1>
        <div class="card">
          <p>Kom i gang ved å legge inn bestillinger dere allerede har gjort.</p>
          <ol class="steps">
            <li>Åpne ordren på <b>maske.no → Min side → Ordrehistorikk</b>.</li>
            <li>Marker all tekst på siden og kopier.</li>
            <li>Lim inn under <b>Ordrer</b>.</li>
          </ol>
          <button class="btn primary" data-act="go" data-to="#/import">Lim inn første ordre</button>
          <button class="btn" data-act="go" data-to="#/innstillinger">Importer fil / sikkerhetskopi</button>
        </div>`;
    }
    const year = todayISO().slice(0, 4);
    const ordersYear = state.orders.filter((o) => o.date.startsWith(year));
    const spentYear = ordersYear.reduce((a, o) => a + o.lines.reduce((x, l) => x + l.sum, 0), 0);
    const avgInt = averageOrderInterval(state);
    const next = nextOrderSuggestion(state);
    const freq = frequencyOptions(state);
    const months = monthlySpend(state);
    const today = todayISO();
    const series = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date();
      d.setDate(1);
      d.setMonth(d.getMonth() - i);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const v = (months.get(ym) || 0) * vatF();
      series.push({ label: monthLabel(ym).split(' ')[0], value: v, tip: `${monthLabel(ym)}: ${fmtKr(v)}` });
    }
    const top = Object.values(state.items)
      .map((it) => ({ it, sum: state.orders.reduce((a, o) => a + o.lines.filter((l) => l.sku === it.sku).reduce((x, l) => x + l.sum, 0), 0) }))
      .sort((a, b) => b.sum - a.sum)
      .slice(0, 5);
    const noCounts = state.counts.length === 0;
    const backupDays = state.settings.lastBackup ? daysBetween(state.settings.lastBackup, today) : null;

    const budget = budgetStatus(state);
    const cats = spendByCategory(state, year);
    const catMax = Math.max(1, ...cats.map((c) => c.sum));
    const latest = [...state.orders].sort((a, b) => b.date.localeCompare(a.date))[0];
    const changes = latest ? priceChanges(state, latest) : [];
    const closedSoon = closedPeriodsBetween(today, addDays(today, 60), state.settings);

    let budgetHtml = '';
    if (budget) {
      const over = budget.projected != null && budget.projected > budget.budget;
      const bv = (x) => fmtKr(x);
      budgetHtml = `
        <div class="card">
          <div class="label">Budsjett ${budget.year} (${budget.incVat ? 'inkl.' : 'eks.'} mva)</div>
          <div class="big">${bv(budget.spent)} <span class="sub">av ${bv(budget.budget)}</span></div>
          <div class="budgetbar" title="Brukt ${fmtNum(budget.pct, 0)} %">
            <div class="fill ${budget.pct > budget.yearPct + 5 ? 'hot' : ''}" style="width:${Math.min(100, budget.pct)}%"></div>
            <div class="mark" style="left:${budget.yearPct}%"></div>
          </div>
          <p class="small">${fmtNum(budget.pct, 0)} % brukt, og ${fmtNum(budget.yearPct, 0)} % av året har gått (streken). ${
            budget.left >= 0 ? `${bv(budget.left)} igjen.` : `<b class="danger">${bv(-budget.left)} over budsjett.</b>`
          }</p>
          ${
            budget.projected != null
              ? `<p class="small ${over ? 'danger' : 'ok'}">Med samme tempo ender året på ca. ${bv(budget.projected)} – ${over ? `${bv(budget.projected - budget.budget)} over` : `${bv(budget.budget - budget.projected)} under`} budsjett.</p>`
              : ''
          }
          <p class="muted small">Denne måneden: ${bv(budget.monthSpent)} av ${bv(budget.monthBudget)} (1/12 av året).</p>
        </div>`;
    }

    let nextHtml = '';
    if (next) {
      const d = daysBetween(today, next.date);
      const when = d <= 0 ? '<b class="warn">Nå</b>' : d === 1 ? 'I morgen' : `Om ${d} dager`;
      nextHtml = `
        <div class="card">
          <div class="label">Neste bestilling</div>
          <div class="big">${when} <span class="sub">${fmtDate(next.date)}</span></div>
          <p class="muted small">${
            next.basis === 'telling'
              ? next.urgent.length
                ? `${next.urgent.length} vare(r) er nede på bufferen, bl.a. ${esc(next.urgent[0].name)}.`
                : `Første vare som blir lav: ${esc(next.item.name)}.`
              : `Basert på rytmen hver ${Math.round(state.settings.intervalDays / 7)}. uke. Tell lageret for et bedre forslag.`
          }</p>
          <div class="row gap">
            <button class="btn primary" data-act="go" data-to="#/telling">Tell lager</button>
            <button class="btn" data-act="go" data-to="#/bestill">Se forslag</button>
          </div>
        </div>`;
    }

    const freqRows = freq.options
      .map(
        (o) => `<tr class="${o.days === freq.recommended ? 'hl' : ''}"><td>Hver ${o.days / 7}. uke</td><td class="num">${money(o.value)}</td><td class="num">${fmtNum((365 / o.days), 0)}/år</td></tr>`
      )
      .join('');
    const freqText =
      freq.known === 0
        ? 'Når appen kjenner forbruket, ser du her hva en bestilling vil koste ved ulike intervaller.'
        : freq.why === 'freeShipping'
          ? `Anbefalt: <b>hver ${freq.recommended / 7}. uke</b>. Det er den hyppigste rytmen der bestillingen når grensen for fri frakt (${money(state.settings.freeShippingMin)}).`
          : `Dere bestiller nå hver ${state.settings.intervalDays / 7}. uke. Går dere ofte tomme, er det mengden og ikke rytmen som må opp. Forslaget i <b>Bestill</b> tar høyde for det. Har dere lite lagerplass, er 2 uker et godt alternativ.`;

    return `
      <h1>Oversikt</h1>
      ${noCounts ? `<div class="card info"><b>Tips:</b> Tell lageret før neste bestilling. Da kan appen regne ut faktisk forbruk i stedet for å anslå det fra bestillingene. <button class="btn small" data-act="go" data-to="#/telling">Start telling</button></div>` : ''}
      ${backupDays == null || backupDays > 30 ? `<div class="card warnbox">Dataene ligger bare på denne telefonen. ${backupDays == null ? 'Du har ikke tatt sikkerhetskopi ennå.' : `Siste sikkerhetskopi er ${backupDays} dager gammel.`} <button class="btn small" data-act="backup">Ta sikkerhetskopi</button></div>` : ''}
      ${nextHtml}
      ${closedSoon
        .map((p) => `<div class="card info small">🏖 <b>${esc(p.label || 'Stengt')}</b> ${fmtDate(p.from)}–${fmtDate(p.to)}. Forslagene regner ikke med forbruk i den perioden.</div>`)
        .join('')}
      <button class="btn block" data-act="go" data-to="#/tomt">⚠ Noe gikk tomt? Registrer det</button>
      ${budgetHtml}
      ${
        changes.length
          ? `<div class="card"><div class="label">Prisendringer i siste ordre (${fmtDate(latest.date)})</div>${priceChangeList(changes)}<p class="muted small">Sammenlignet med forrige gang varen ble kjøpt. Grense: ${state.settings.priceAlertPct} %.</p></div>`
          : ''
      }
      <div class="tiles">
        <div class="tile"><div class="label">Brukt i ${year}</div><div class="val">${money(spentYear)}</div><div class="sub">${vatLabel()}</div></div>
        <div class="tile"><div class="label">Ordrer i ${year}</div><div class="val">${ordersYear.length}</div><div class="sub">snitt ${money(ordersYear.length ? spentYear / ordersYear.length : 0)}</div></div>
        <div class="tile"><div class="label">Dager mellom ordrer</div><div class="val">${avgInt ? fmtNum(avgInt, 0) : '–'}</div><div class="sub">i snitt</div></div>
        <div class="tile"><div class="label">Varer</div><div class="val">${Object.keys(state.items).length}</div><div class="sub">i katalogen</div></div>
      </div>
      <div class="card">
        <div class="label">Kostnad per måned (${vatLabel()})</div>
        ${barChart(series, { ariaLabel: 'Kostnad per måned siste 12 måneder' })}
        <details><summary>Vis som tabell</summary><table class="tbl">${series.map((s) => `<tr><td>${esc(s.tip.split(':')[0])}</td><td class="num">${fmtKr(s.value)}</td></tr>`).join('')}</table></details>
      </div>
      <div class="card">
        <div class="label">Hvor ofte bør dere bestille?</div>
        <p class="small">${freqText}</p>
        <table class="tbl"><tr><th>Rytme</th><th class="num">Ca. per ordre</th><th class="num">Ordrer</th></tr>${freqRows}</table>
        ${freq.known ? `<p class="muted small">Forbruk ca. ${money(freq.daily * 7)} per uke for ${freq.known} varer.</p>` : ''}
      </div>
      ${
        cats.length
          ? `<div class="card"><div class="label">Kostnad per kategori i ${year} (${vatLabel()})</div>${cats
              .map(
                (c) => `<div class="catrow"><span class="cname2">${esc(c.category)}</span><span class="cbar"><i style="width:${(c.sum / catMax) * 100}%"></i></span><span class="num">${money(c.sum)}</span></div>`
              )
              .join('')}<p class="muted small">Kategori kan endres på hver vare.</p></div>`
          : ''
      }
      ${!budget ? `<p class="muted small">Har dere budsjett for forbruksvarer? Legg det inn under <button class="link small" data-act="go" data-to="#/innstillinger">Innstillinger</button>, så følger appen med.</p>` : ''}
      <div class="card">
        <div class="label">Mest penger brukt på</div>
        <ul class="list">${top
          .map((t) => `<li><button class="link" data-act="go" data-to="#/vare/${esc(t.it.sku)}">${esc(t.it.name)}</button><span class="num">${money(t.sum)}</span></li>`)
          .join('')}</ul>
      </div>`;
  },

  telling() {
    const items = Object.values(state.items).filter(isPlanned).sort(byCategoryThenName);
    const count = state.counts.find((c) => c.date === ui.countDate);
    const entries = count?.entries || {};
    const done = items.filter((i) => entries[i.sku] != null).length;
    if (!items.length) return `<h1>Telling</h1><div class="card">Ingen varer ennå. Legg inn en ordre først.</div>`;
    const rows = withCategoryHeaders(
      items,
      (it) => {
        const st = itemStats(state, it.sku);
        const prev = st.counts.filter((c) => c.date < ui.countDate).pop();
        const v = entries[it.sku];
        let inputs;
        if (it.perUnit && it.subUnit) {
          const whole = v != null ? Math.floor(v + 1e-9) : '';
          const rest = v != null ? Math.round((v - whole) * it.perUnit) : '';
          inputs = `
            <label class="cnt"><input inputmode="decimal" data-chg="count" data-sku="${esc(it.sku)}" data-part="whole" value="${whole}" placeholder="0"><span>${esc(unitOf(it))}</span></label>
            <label class="cnt"><input inputmode="numeric" data-chg="count" data-sku="${esc(it.sku)}" data-part="rest" value="${rest}" placeholder="0"><span>${esc(it.subUnit)}</span></label>`;
        } else {
          inputs = `<label class="cnt"><input inputmode="decimal" data-chg="count" data-sku="${esc(it.sku)}" data-part="whole" value="${v != null ? String(v).replace('.', ',') : ''}" placeholder="–"><span>${esc(unitOf(it))}</span></label>`;
        }
        return `
          <div class="crow ${v != null ? 'done' : ''}" data-row="${esc(it.sku)}">
            <div class="cname"><b>${esc(it.name)}</b>
              <div class="muted small">${esc(it.sku)} · forrige: ${prev ? `${qtyText(it, prev.qty)} (${fmtDate(prev.date)})` : 'ikke talt'}</div>
            </div>
            <div class="cinputs">${inputs}</div>
          </div>`;
      },
      (cat) => `<div class="ghead">${esc(cat)}</div>`
    );
    return `
      <h1>Telling</h1>
      <div class="card">
        <label class="field">Dato for telling <input type="date" data-chg="countDate" value="${ui.countDate}"></label>
        <p class="muted small">Tell før du bestiller. Skriv <b>0</b> hvis varen er tom, og la feltet stå tomt hvis du ikke har talt den. Alt lagres med en gang.</p>
        <p class="muted small">Vil du telle løse pakker i en kartong? Åpne varen under <b>Varer</b> og fyll inn hvor mange det er i hver.</p>
        <div class="progress"><div style="width:${(done / items.length) * 100}%"></div></div>
        <div class="small muted" id="countProgress">${done} av ${items.length} varer talt</div>
      </div>
      <div class="card flush">${rows}</div>
      <button class="btn primary block" data-act="go" data-to="#/bestill">Ferdig – se bestillingsforslag</button>`;
  },

  bestill() {
    const plan = buildOrderPlan(state);
    const s = state.settings;
    const chips = [7, 14, 21, 28, 42]
      .map((d) => `<button class="chip ${s.intervalDays === d ? 'on' : ''}" data-act="interval" data-days="${d}">${d / 7} ${d === 7 ? 'uke' : 'uker'}</button>`)
      .join('');
    const rows = plan.rows
      .map((r) => {
        const { item: it, stats: st, rec } = r;
        const badges = [];
        if (rec.reason === 'ikke-talt') badges.push('<span class="badge warn">tell først</span>');
        if (rec.reason === 'ingen-data') badges.push('<span class="badge muted">ingen data</span>');
        if (st.boosted) badges.push(`<span class="badge danger">har gått tomt, +${s.stockoutBoost} %</span>`);
        else if (st.stockoutEvents) badges.push(`<span class="badge danger">gikk tomt ${st.stockoutEvents}×</span>`);
        const info = [];
        if (st.stockNow != null) info.push(`lager ca. ${qtyText(it, st.stockNow)}`);
        if (st.onTheWay) info.push(`på vei ${fmtNum(st.onTheWay)}`);
        if (st.effRate != null) info.push(`forbruk ${fmtNum(perWeek(st.effRate), 1)}/uke`);
        if (st.daysLeft != null) info.push(`holder ${fmtNum(st.daysLeft, 0)} d`);
        return `
          <div class="orow ${r.qty > 0 ? '' : 'zero'}">
            <div class="oname"><button class="link" data-act="go" data-to="#/vare/${esc(it.sku)}"><b>${esc(it.name)}</b></button>
              <div class="muted small">${esc(it.sku)} · ${info.join(' · ') || 'ukjent forbruk'}</div>
              <div>${badges.join(' ')} ${sourceBadge(st)} ${
                r.adjusted ? `<span class="badge">justert, forslag ${rec.qty}</span> <button class="link small" data-act="resetQty" data-sku="${esc(it.sku)}">tilbakestill</button>` : ''
              }</div>
            </div>
            <div class="stepper">
              <button data-act="qty" data-sku="${esc(it.sku)}" data-d="-1" aria-label="Færre">−</button>
              <span class="q">${r.qty}</span>
              <button data-act="qty" data-sku="${esc(it.sku)}" data-d="1" aria-label="Flere">+</button>
              <div class="muted small cost">${r.price != null ? money(r.cost) : ''}</div>
            </div>
          </div>`;
      })
      .join('');
    const count = plan.rows.filter((r) => r.qty > 0).length;
    const budget = budgetStatus(state);
    const budgetHtml = budget
      ? `<div class="small muted">Etter bestillingen: ${fmtNum(((budget.spent + plan.total * (budget.incVat ? 1.25 : 1)) / budget.budget) * 100, 0)} % av årsbudsjettet</div>`
      : '';
    const fs = s.freeShippingMin;
    const fsHtml = fs
      ? `<div class="small ${plan.total >= fs ? 'ok' : 'warn'}">${plan.total >= fs ? '✓ Over grensen for fri frakt' : `${fmtKr(fs - plan.total)} under grensen for fri frakt (eks. mva)`}</div>`
      : '';
    return `
      <h1>Bestillingsforslag</h1>
      <div class="card">
        <div class="label">Hvor lenge skal bestillingen vare?</div>
        <div class="chips">${chips}</div>
        <p class="muted small">Forslaget dekker leveringstid (${s.leadDays} d) + perioden + buffer (${s.safetyDays} d), minus det som er på lager. Er det registrert <i>når</i> en vare gikk tom, brukes det faktiske forbruket. Ellers får varer som har vært tomme +${s.stockoutBoost} % ekstra.</p>
        ${closedPeriodsBetween(todayISO(), addDays(todayISO(), s.leadDays + s.intervalDays + s.safetyDays), s)
          .map((p) => `<p class="small">🏖 ${esc(p.label || 'Stengt')} ${fmtDate(p.from)}–${fmtDate(p.to)} er trukket fra.</p>`)
          .join('')}
      </div>
      <div class="card flush">${rows || '<p class="pad">Ingen varer ennå.</p>'}</div>
      <div class="sticky-sum">
        <div><b>${count} varer · ${money(plan.total)}</b> <span class="muted small">${vatLabel()}</span>${fsHtml}${budgetHtml}</div>
        <div class="row gap">
          <button class="btn small" data-act="resetAll">Nullstill</button>
          <button class="btn small primary" data-act="copyList">Kopier liste</button>
        </div>
      </div>`;
  },

  ordrer() {
    const orders = [...state.orders].sort((a, b) => b.date.localeCompare(a.date));
    return `
      <h1>Ordrer</h1>
      <button class="btn primary block" data-act="go" data-to="#/import">+ Lim inn ordre fra Maske</button>
      <div class="card flush">
        ${
          orders.length
            ? `<ul class="list roomy">${orders
                .map((o) => {
                  const sum = o.lines.reduce((a, l) => a + l.sum, 0);
                  return `<li><button class="link" data-act="go" data-to="#/ordre/${encodeURIComponent(o.id)}"><b>${fmtDate(o.date)}</b> <span class="muted small">${esc(o.id)} · ${o.lines.length} varer</span></button><span class="num">${money(sum)}</span></li>`;
                })
                .join('')}</ul>`
            : '<p class="pad muted">Ingen ordrer ennå.</p>'
        }
      </div>`;
  },

  import() {
    const p = ui.preview;
    let preview = '';
    if (p) {
      const exists = p.id && state.orders.some((o) => o.id === p.id);
      preview = `
        <div class="card">
          <div class="label">Fant dette</div>
          <p><b>Ordre ${esc(p.id || '?')}</b> · ${fmtDate(p.date)} · ${p.lines.length} varelinjer</p>
          <table class="tbl"><tr><th>Vare</th><th class="num">Pris</th><th class="num">Ant.</th></tr>
          ${p.lines.map((l) => `<tr><td>${esc(l.name)}<div class="muted small">${esc(l.sku)}</div></td><td class="num">${fmtNum(l.price, 2)}</td><td class="num">${fmtNum(l.qty)}</td></tr>`).join('')}
          <tr><td>Sum eks. mva</td><td class="num" colspan="2">${fmtNum(p.linesSum, 2)}</td></tr>
          <tr><td>Mva${p.vatEstimated ? ' (regnet ut, 25 %)' : ''}</td><td class="num" colspan="2">${fmtNum(p.linesVat, 2)}</td></tr>
          <tr><td><b>Sum inkl. mva</b></td><td class="num" colspan="2"><b>${fmtNum(p.linesSumInc, 2)}</b></td></tr>
          ${p.total != null ? `<tr><td>Totalt inkl. mva (fra siden)</td><td class="num" colspan="2">${fmtNum(p.total, 2)}</td></tr>` : ''}
          </table>
          <p class="muted small">Prisene per vare er eks. mva, slik Maske viser dem. Mva er lagret på hver linje. Vil du se alle beløp i appen inkl. mva, slår du det på under ⚙ Innstillinger.</p>
          <table class="tbl">
          </table>
          ${p.warnings.map((w) => `<p class="warn small">⚠ ${esc(w)}</p>`).join('')}
          ${(() => {
            if (!p.date) return '';
            const ch = priceChanges(state, { id: p.id, date: p.date, lines: p.lines });
            const up = ch.filter((c) => c.pct > 0);
            return ch.length
              ? `<div class="${up.length ? 'warnbox' : ''} pricebox"><b>${up.length ? `⚠ ${up.length} vare(r) er blitt dyrere` : 'Prisendringer'}</b> siden forrige kjøp (over ${state.settings.priceAlertPct} %):${priceChangeList(ch)}</div>`
              : '';
          })()}
          ${p.ok ? '<p class="ok small">✓ Summen stemmer med ordretotalen.</p>' : ''}
          ${!p.date ? `<label class="field">Ordredato <input type="date" data-chg="previewDate" value=""></label>` : ''}
          ${exists ? '<p class="warn small">Denne ordren finnes fra før. Lagrer du, blir den erstattet.</p>' : ''}
          <button class="btn primary block" data-act="saveImport" ${p.lines.length && p.date ? '' : 'disabled'}>Lagre ordre</button>
        </div>`;
    }
    return `
      <h1>Lim inn ordre</h1>
      <div class="card">
        <ol class="steps small">
          <li>Gå til <b>maske.no → Min side → Ordrehistorikk</b> og åpne ordren.</li>
          <li>Hold fingeren på teksten, velg <b>Merk alt</b> og <b>Kopier</b>.</li>
          <li>Lim inn her og trykk <b>Les ordre</b>.</li>
        </ol>
        <textarea id="paste" rows="6" placeholder="Lim inn teksten fra ordresiden her">${esc(ui.pasteText)}</textarea>
        <div class="row gap">
          <button class="btn" data-act="pasteClipboard">Lim inn fra utklippstavle</button>
          <button class="btn primary" data-act="parse">Les ordre</button>
        </div>
      </div>
      ${preview}`;
  },

  ordre(id) {
    const o = state.orders.find((x) => x.id === id);
    if (!o) return `<h1>Fant ikke ordren</h1>`;
    const sum = o.lines.reduce((a, l) => a + l.sum, 0);
    const vat = o.lines.reduce((a, l) => a + (l.vat ?? l.sum * 0.25), 0);
    return `
      <button class="link" data-act="go" data-to="#/ordrer">← Ordrer</button>
      <h1>Ordre ${esc(o.id)}</h1>
      <div class="card">
        <label class="field">Ordredato <input type="date" data-chg="orderField" data-id="${esc(o.id)}" data-field="date" value="${o.date}"></label>
        <label class="field">Levert dato <input type="date" data-chg="orderField" data-id="${esc(o.id)}" data-field="receivedDate" value="${o.receivedDate || ''}"></label>
        ${!o.receivedDate ? `<button class="btn small" data-act="receivedToday" data-id="${esc(o.id)}">Kom i dag</button><p class="muted small">Ikke registrert. Appen regner med levering ${fmtDate(addDays(o.date, state.settings.leadDays))}.</p>` : `<p class="muted small">Leveringstid: ${daysBetween(o.date, o.receivedDate)} dager.</p>`}
      </div>
      <div class="card">
        <table class="tbl"><tr><th>Vare</th><th class="num">Pris</th><th class="num">Ant.</th><th class="num">Sum</th></tr>
        ${o.lines.map((l) => `<tr><td><button class="link" data-act="go" data-to="#/vare/${esc(l.sku)}">${esc(l.name)}</button></td><td class="num">${fmtNum(l.price * vatF(), 2)}</td><td class="num">${fmtNum(l.qty)}</td><td class="num">${fmtNum(l.sum * vatF(), 2)}</td></tr>`).join('')}
        </table>
        <table class="tbl">
          <tr><td>Sum eks. mva</td><td class="num">${fmtNum(sum, 2)}</td></tr>
          <tr><td>Mva</td><td class="num">${fmtNum(vat, 2)}</td></tr>
          <tr><td><b>Sum inkl. mva</b></td><td class="num"><b>${fmtNum(sum + vat, 2)}</b></td></tr>
        </table>
        <p class="muted small">Prisene i tabellen over er ${vatLabel()}.</p>
      </div>
      ${(() => {
        const ch = priceChanges(state, o);
        return ch.length ? `<div class="card"><div class="label">Prisendringer mot forrige kjøp</div>${priceChangeList(ch)}</div>` : '';
      })()}
      <button class="btn danger" data-act="deleteOrder" data-id="${esc(o.id)}">Slett ordre</button>`;
  },

  varer() {
    const items = Object.values(state.items).sort(byCategoryThenName);
    return `
      <h1>Varer</h1>
      <input class="search" type="search" placeholder="Søk i varer" data-input="filter">
      <div class="card flush">
        <ul class="list roomy" id="itemList">${withCategoryHeaders(
          items,
          (it) => {
            const st = itemStats(state, it.sku);
            const p = lastPrice(state, it.sku);
            return `<li data-name="${esc((it.name + ' ' + it.sku + ' ' + (it.category || '')).toLowerCase())}" class="${it.active === false ? 'inactive' : ''}"><button class="link" data-act="go" data-to="#/vare/${esc(it.sku)}"><b>${esc(it.name)}</b><span class="muted small">${esc(it.sku)} · ${
              st.effRate != null ? `${fmtNum(perWeek(st.effRate), 1)} ${esc(unitOf(it))}/uke` : 'ukjent forbruk'
            }${it.consumable === false ? ' · utstyr' : ''}${st.boosted ? ' · <span class="danger">går tomt</span>' : ''}</span></button><span class="num">${p != null ? money(p, 2) : ''}</span></li>`;
          },
          (cat) => `<li class="ghead" data-name="">${esc(cat)}</li>`
        )}</ul>
      </div>
      <details class="card"><summary>Legg til vare manuelt</summary>
        <label class="field">Varenummer <input id="newSku" inputmode="numeric"></label>
        <label class="field">Navn <input id="newName"></label>
        <button class="btn primary" data-act="addItem">Legg til</button>
      </details>`;
  },

  vare(sku) {
    const it = state.items[sku];
    if (!it) return `<h1>Fant ikke varen</h1>`;
    const st = itemStats(state, sku);
    const ph = priceHistory(state, sku);
    const first = ph[0];
    const last = ph[ph.length - 1];
    const change = first && last && first.price ? ((last.price - first.price) / first.price) * 100 : null;
    const priceChart =
      ph.length >= 2
        ? lineChart(
            ph.map((p) => ({ label: fmtDate(p.date).slice(0, 5), value: p.price * vatF(), tip: `${fmtDate(p.date)}: ${fmtKr(p.price * vatF(), 2)} (${fmtNum(p.qty)} ${unitOf(it)})` })),
            { ariaLabel: 'Prisutvikling' }
          )
        : '<p class="muted small">Prisutviklingen vises når varen finnes i minst to ordrer.</p>';
    const f = (field, label, type = 'text', extra = '') =>
      `<label class="field">${label} <input type="${type}" ${extra} data-chg="itemField" data-sku="${esc(sku)}" data-field="${field}" value="${esc(it[field] ?? '')}"></label>`;
    return `
      <button class="link" data-act="back">← Tilbake</button>
      <h1>${esc(it.name)}</h1>
      <p class="muted small">Varenr. ${esc(sku)}</p>
      <div class="tiles">
        <div class="tile"><div class="label">Siste pris</div><div class="val">${last ? money(last.price, 2) : '–'}</div><div class="sub">${change != null ? `${change >= 0 ? '+' : ''}${fmtNum(change, 1)} % siden ${fmtDate(first.date)}` : vatLabel()}</div></div>
        <div class="tile"><div class="label">Forbruk</div><div class="val">${st.effRate != null ? fmtNum(perWeek(st.effRate), 1) : '–'}</div><div class="sub">${esc(unitOf(it))} per uke ${st.boosted ? '(inkl. påslag)' : ''}</div></div>
        <div class="tile"><div class="label">Lager nå (ca.)</div><div class="val">${st.stockNow != null ? fmtNum(st.stockNow, 1) : '–'}</div><div class="sub">${st.lastCount ? `talt ${fmtDate(st.lastCount.date)}` : 'ikke talt'}</div></div>
        <div class="tile"><div class="label">Gått tomt</div><div class="val">${st.points.filter((x) => x.qty <= 0).length}</div><div class="sub">ganger registrert</div></div>
      </div>
      <div class="card">
        <div class="label">Gikk varen tom?</div>
        <div class="row gap">
          <button class="btn" data-act="markEmpty" data-sku="${esc(sku)}" data-date="${todayISO()}">Gikk tomt i dag</button>
          <button class="btn" data-act="go" data-to="#/tomt">Annen dato…</button>
        </div>
        ${(() => {
          const ev = (state.stockouts || []).filter((e) => e.sku === sku).sort((a, b) => b.date.localeCompare(a.date));
          return ev.length
            ? `<ul class="list">${ev.map((e) => `<li><span>Tomt ${fmtDate(e.date)}</span><button class="link small" data-act="unmarkEmpty" data-sku="${esc(sku)}" data-date="${e.date}">angre</button></li>`).join('')}</ul>`
            : '<p class="muted small">Registrer når varen går tom, så lærer appen det faktiske forbruket.</p>';
        })()}
      </div>
      ${st.anomalies ? `<div class="card warnbox small">${st.anomalies} telling(er) gir negativt forbruk (mer på lager enn mulig). Sjekk tellingene eller om en ordre mangler. De er holdt utenfor beregningen.</div>` : ''}
      <div class="card">
        <div class="label">Pris per ${esc(unitOf(it))} (${vatLabel()})</div>
        ${priceChart}
        ${ph.length ? `<details><summary>Vis som tabell</summary><table class="tbl">${ph.map((p) => `<tr><td>${fmtDate(p.date)}</td><td class="num">${fmtNum(p.qty)} stk</td><td class="num">${fmtKr(p.price * vatF(), 2)}</td></tr>`).join('')}</table></details>` : ''}
        ${it.perUnit && last ? `<p class="muted small">≈ ${money(last.price / it.perUnit, 2)} per ${esc(it.subUnit || 'pakke')}</p>` : ''}
      </div>
      <div class="card">
        <div class="label">Innstillinger for varen</div>
        ${f('name', 'Navn')}
        <label class="field">Kategori <select data-chg="itemField" data-sku="${esc(sku)}" data-field="category">${CATEGORIES.map(
          (c) => `<option ${c === (it.category || 'Annet') ? 'selected' : ''}>${esc(c)}</option>`
        ).join('')}</select></label>
        ${f('unit', 'Bestillingsenhet (f.eks. kartong, pakke, stk)')}
        <div class="row gap">
          ${f('perUnit', 'Antall i hver', 'text', 'inputmode="decimal" placeholder="f.eks. 20"')}
          ${f('subUnit', 'Hva telles inni', 'text', 'placeholder="f.eks. pakke"')}
        </div>
        ${f('minQty', 'Bestill alltid minst', 'text', 'inputmode="decimal"')}
        ${f('note', 'Notat')}
        <label class="check"><input type="checkbox" data-chg="itemFlag" data-flag="consumable" data-sku="${esc(sku)}" ${it.consumable !== false ? 'checked' : ''}> Forbruksvare (brukes opp og bestilles jevnlig)</label>
        <p class="muted small">Ta bort haken for utstyr og engangskjøp, f.eks. pedalbøtte eller musematte. De holdes da utenfor telling og forslag, men vises fortsatt i statistikken.</p>
        <label class="check"><input type="checkbox" data-chg="itemFlag" data-flag="active" data-sku="${esc(sku)}" ${it.active !== false ? 'checked' : ''}> Aktiv (fjern haken hvis dere har sluttet å kjøpe varen)</label>
      </div>
      ${
        st.intervals.length
          ? `<div class="card"><div class="label">Forbruk mellom tellinger og tom-registreringer</div><table class="tbl"><tr><th>Periode</th><th class="num">Inn</th><th class="num">Brukt</th></tr>${st.intervals
              .map((iv) => `<tr class="${iv.negative ? 'warn' : ''}"><td>${fmtDate(iv.from).slice(0, 5)}–${fmtDate(iv.to).slice(0, 5)}${iv.stockout ? ` <span class="badge danger">${iv.dated ? 'gikk tomt' : 'tomt ved telling'}</span>` : ''}</td><td class="num">${fmtNum(iv.received)}</td><td class="num">${fmtNum(iv.used, 1)}</td></tr>`)
              .join('')}</table></div>`
          : ''
      }`;
  },

  tomt() {
    const items = Object.values(state.items).filter(isPlanned).sort(byCategoryThenName);
    const marked = new Set((state.stockouts || []).filter((e) => e.date === ui.stockoutDate).map((e) => e.sku));
    const recent = [...(state.stockouts || [])].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
    return `
      <h1>Gikk tomt</h1>
      <div class="card">
        <label class="field">Dato varen gikk tom <input type="date" data-chg="stockoutDate" value="${ui.stockoutDate}"></label>
        <p class="muted small">Trykk på varen som gikk tom. Da vet appen hvor fort den faktisk brukes, og neste forslag blir større.</p>
      </div>
      <input class="search" type="search" placeholder="Søk i varer" data-input="filter">
      <div class="card flush"><ul class="list roomy" id="itemList">${withCategoryHeaders(
        items,
        (it) => `<li data-name="${esc((it.name + ' ' + it.sku).toLowerCase())}"><span>${esc(it.name)}</span>${
          marked.has(it.sku)
            ? `<button class="btn small" data-act="unmarkEmpty" data-sku="${esc(it.sku)}" data-date="${ui.stockoutDate}">✓ Registrert</button>`
            : `<button class="btn small danger" data-act="markEmpty" data-sku="${esc(it.sku)}" data-date="${ui.stockoutDate}">Tomt</button>`
        }</li>`,
        (cat) => `<li class="ghead" data-name="">${esc(cat)}</li>`
      )}</ul></div>
      ${
        recent.length
          ? `<div class="card"><div class="label">Siste registreringer</div><ul class="list">${recent
              .map((e) => `<li><span>${esc(state.items[e.sku]?.name || e.sku)} <span class="muted small">${fmtDate(e.date)}</span></span><button class="link small" data-act="unmarkEmpty" data-sku="${esc(e.sku)}" data-date="${e.date}">angre</button></li>`)
              .join('')}</ul></div>`
          : ''
      }`;
  },

  innstillinger() {
    const s = state.settings;
    const n = (field, label, help) =>
      `<label class="field">${label} <input inputmode="decimal" data-chg="setting" data-field="${field}" value="${s[field] ?? ''}">${help ? `<span class="muted small">${help}</span>` : ''}</label>`;
    return `
      <h1>Innstillinger</h1>
      <div class="card">
        ${n('leadDays', 'Leveringstid (dager)', 'Brukes når levert dato ikke er registrert på ordren.')}
        ${n('intervalDays', 'Bestiller vanligvis hver … dag', '21 = hver 3. uke')}
        ${n('safetyDays', 'Buffer (dager)', 'Ekstra lager så dere ikke går tomme hvis noe går fortere enn vanlig.')}
        ${n('stockoutBoost', 'Påslag for varer som har gått tomme (%)', 'Har lageret vært tomt, vet vi ikke hvor mye som egentlig ville blitt brukt.')}
        ${n('freeShippingMin', 'Grense for fri frakt (kr eks. mva)', 'La stå tomt hvis ukjent.')}
        ${n('priceAlertPct', 'Prisvarsel ved endring over (%)', 'Vises når du limer inn en ordre og på oversikten.')}
        <label class="check"><input type="checkbox" data-chg="showVat" ${s.showVat ? 'checked' : ''}> Vis beløp inkl. mva</label>
      </div>
      <div class="card">
        <div class="label">Budsjett</div>
        ${n('budgetYear', 'Årsbudsjett for forbruksvarer (kr)', 'La stå tomt hvis dere ikke har budsjett.')}
        <label class="check"><input type="checkbox" data-chg="budgetIncVat" ${s.budgetIncVat ? 'checked' : ''}> Budsjettet er inkl. mva</label>
      </div>
      <div class="card">
        <div class="label">Stengte perioder</div>
        <p class="muted small">Ferier og andre dager barnehagen er stengt. Da regnes det ikke med forbruk, og forslag før en ferie blir mindre.</p>
        ${(s.closedPeriods || [])
          .map(
            (p, i) => `<div class="closedrow">
              <input data-chg="closedEdit" data-i="${i}" data-field="label" value="${esc(p.label || '')}" placeholder="Navn">
              <div class="row gap"><input type="date" data-chg="closedEdit" data-i="${i}" data-field="from" value="${p.from}"><input type="date" data-chg="closedEdit" data-i="${i}" data-field="to" value="${p.to}"></div>
              <button class="link small" data-act="deleteClosed" data-i="${i}">Slett</button>
            </div>`
          )
          .join('')}
        <div class="row gap">
          <button class="btn small" data-act="addClosed">+ Legg til periode</button>
          <button class="btn small" data-act="addSummer">+ Sommerferie (juli)</button>
        </div>
      </div>
      <div class="card">
        <div class="label">Sikkerhetskopi</div>
        <p class="small">Dataene ligger bare på denne telefonen. Ta sikkerhetskopi jevnlig og lagre filen et trygt sted (f.eks. Google Disk).</p>
        <p class="muted small">Siste: ${s.lastBackup ? fmtDate(s.lastBackup) : 'aldri'}</p>
        <button class="btn primary" data-act="backup">Last ned sikkerhetskopi</button>
        <label class="btn">Importer fil… <input type="file" accept=".json,application/json" data-chg="importFile" hidden></label>
        ${ui.importMsg ? `<p class="ok small">${esc(ui.importMsg)}</p>` : ''}
      </div>
      <div class="card">
        <div class="label">Faresone</div>
        <button class="btn danger" data-act="wipe">Slett alle data</button>
      </div>
      <p class="muted small center">Bestillingshjelp · data lagres lokalt</p>`;
  },
};

// ---------- Ruting ----------
function parseRoute() {
  const h = location.hash.replace(/^#\/?/, '');
  const [name, ...rest] = h.split('/');
  return { name: name || 'home', param: rest.length ? decodeURIComponent(rest.join('/')) : null };
}

function render() {
  const r = parseRoute();
  const fn = views[r.name] || views.home;
  const scroll = window.scrollY;
  $main().innerHTML = fn(r.param);
  const tab = { home: 'home', telling: 'telling', bestill: 'bestill', ordrer: 'ordrer', import: 'ordrer', ordre: 'ordrer', varer: 'varer', vare: 'varer', tomt: 'home' }[r.name];
  document.querySelectorAll('nav.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  if (render._last === location.hash) window.scrollTo(0, scroll);
  else window.scrollTo(0, 0);
  render._last = location.hash;
}

// ---------- Handlinger ----------
const actions = {
  go: (el) => (location.hash = el.dataset.to),
  back: () => history.back(),
  interval(el) {
    state.settings.intervalDays = Number(el.dataset.days);
    state.draft = {};
    commit();
  },
  qty(el) {
    const sku = el.dataset.sku;
    const plan = buildOrderPlan(state);
    const row = plan.rows.find((r) => r.item.sku === sku);
    const next = Math.max(0, (row ? row.qty : 0) + Number(el.dataset.d));
    if (row && next === row.rec.qty) delete state.draft[sku];
    else state.draft[sku] = next;
    commit();
  },
  resetQty(el) {
    delete state.draft[el.dataset.sku];
    commit();
  },
  resetAll() {
    state.draft = {};
    commit();
  },
  async copyList() {
    const plan = buildOrderPlan(state);
    const lines = plan.rows.filter((r) => r.qty > 0).map((r) => `${r.item.sku}  ${r.qty} × ${r.item.name}`);
    const text = `Bestilling ${fmtDate(todayISO())}\n${lines.join('\n')}\n\nCa. ${fmtKr(plan.total)} eks. mva`;
    try {
      await navigator.clipboard.writeText(text);
      toast('Handlelisten er kopiert');
    } catch {
      prompt('Kopier listen:', text);
    }
  },
  async pasteClipboard() {
    try {
      ui.pasteText = await navigator.clipboard.readText();
      actions.parse();
    } catch {
      toast('Fikk ikke tilgang. Hold fingeren i feltet og velg Lim inn.');
    }
  },
  parse() {
    const ta = document.getElementById('paste');
    if (ta) ui.pasteText = ta.value;
    ui.preview = parseMaskeOrder(ui.pasteText);
    render();
  },
  saveImport() {
    const p = ui.preview;
    if (!p || !p.lines.length || !p.date) return;
    const id = p.id || `manuell-${p.date}`;
    const order = { id, date: p.date, reference: p.reference || '', total: p.total ?? null, vat: p.vat ?? null, freight: p.freight ?? 0, receivedDate: null, lines: p.lines };
    state.orders = state.orders.filter((o) => o.id !== id);
    state.orders.push(order);
    ensureItemsFromOrder(order);
    // Fyll inn navn som manglet (f.eks. fra et avkuttet skjermbilde).
    for (const l of order.lines) {
      const it = state.items[l.sku];
      if (it && (!it.name || /navn mangler/.test(it.name))) it.name = l.name;
    }
    state.draft = {};
    ui.preview = null;
    ui.pasteText = '';
    persist();
    toast(`Ordre ${id} lagret`);
    location.hash = `#/ordre/${encodeURIComponent(id)}`;
  },
  markEmpty(el) {
    const { sku, date } = el.dataset;
    state.stockouts = (state.stockouts || []).filter((e) => !(e.sku === sku && e.date === date));
    state.stockouts.push({ sku, date });
    toast(`Registrert: ${state.items[sku]?.name || sku} gikk tomt ${fmtDate(date)}`);
    commit();
  },
  unmarkEmpty(el) {
    const { sku, date } = el.dataset;
    state.stockouts = (state.stockouts || []).filter((e) => !(e.sku === sku && e.date === date));
    commit();
  },
  addClosed() {
    const t = todayISO();
    state.settings.closedPeriods = [...(state.settings.closedPeriods || []), { from: t, to: t, label: 'Stengt' }];
    commit();
  },
  addSummer() {
    const t = todayISO();
    const y = t.slice(5) > '07-31' ? Number(t.slice(0, 4)) + 1 : Number(t.slice(0, 4));
    state.settings.closedPeriods = [...(state.settings.closedPeriods || []), { from: `${y}-07-01`, to: `${y}-07-31`, label: `Sommerferie ${y}` }];
    commit();
  },
  deleteClosed(el) {
    const i = Number(el.dataset.i);
    state.settings.closedPeriods = (state.settings.closedPeriods || []).filter((_, j) => j !== i);
    commit();
  },
  receivedToday(el) {
    const o = state.orders.find((x) => x.id === el.dataset.id);
    if (o) o.receivedDate = todayISO();
    commit();
  },
  deleteOrder(el) {
    if (!confirm('Slette ordren? Varene blir liggende i katalogen.')) return;
    state.orders = state.orders.filter((o) => o.id !== el.dataset.id);
    persist();
    location.hash = '#/ordrer';
  },
  addItem() {
    const sku = document.getElementById('newSku').value.trim();
    const name = document.getElementById('newName').value.trim();
    if (!sku || !name) return toast('Fyll inn varenummer og navn');
    if (state.items[sku]) return toast('Varen finnes allerede');
    state.items[sku] = newItem(sku, name);
    commit();
  },
  backup() {
    const today = todayISO();
    state.settings.lastBackup = today;
    persist();
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `maske-bestilling-${today}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
    render();
  },
  wipe() {
    if (!confirm('Slette ALLE data på denne telefonen?')) return;
    if (!confirm('Er du helt sikker? Dette kan ikke angres uten sikkerhetskopi.')) return;
    state = emptyState();
    commit();
  },
};

const changes = {
  stockoutDate(el) {
    ui.stockoutDate = el.value || todayISO();
    render();
  },
  budgetIncVat(el) {
    state.settings.budgetIncVat = el.checked;
    commit();
  },
  closedEdit(el) {
    const list = (state.settings.closedPeriods || []).map((p) => ({ ...p }));
    const p = list[Number(el.dataset.i)];
    if (!p) return;
    p[el.dataset.field] = el.value;
    if (p.from && p.to && p.to < p.from) p.to = p.from;
    state.settings.closedPeriods = list; // ny liste, så beregningene oppdateres
    commit();
  },
  countDate(el) {
    ui.countDate = el.value || todayISO();
    render();
  },
  count(el) {
    const sku = el.dataset.sku;
    const it = state.items[sku];
    const row = el.closest('[data-row]');
    const whole = parseInput(row.querySelector('[data-part="whole"]').value);
    const restEl = row.querySelector('[data-part="rest"]');
    const rest = restEl ? parseInput(restEl.value) : NaN;
    let c = state.counts.find((x) => x.date === ui.countDate);
    if (!c) {
      c = { id: ui.countDate, date: ui.countDate, entries: {} };
      state.counts.push(c);
    }
    if (Number.isNaN(whole) && Number.isNaN(rest)) delete c.entries[sku];
    else c.entries[sku] = round2((Number.isNaN(whole) ? 0 : whole) + (Number.isNaN(rest) || !it.perUnit ? 0 : rest / it.perUnit));
    if (!Object.keys(c.entries).length) state.counts = state.counts.filter((x) => x !== c);
    // Ingen full omtegning her, så fokus blir stående i neste felt.
    row.classList.toggle('done', c.entries[sku] != null);
    const items = Object.values(state.items).filter(isPlanned);
    const done = items.filter((i) => c.entries[i.sku] != null).length;
    const p = document.getElementById('countProgress');
    if (p) p.textContent = `${done} av ${items.length} varer talt`;
    const bar = document.querySelector('.progress div');
    if (bar) bar.style.width = `${(done / items.length) * 100}%`;
    persist();
  },
  previewDate(el) {
    if (ui.preview) ui.preview.date = el.value;
    render();
  },
  orderField(el) {
    const o = state.orders.find((x) => x.id === el.dataset.id);
    if (!o) return;
    if (el.dataset.field === 'date' && !el.value) return;
    o[el.dataset.field] = el.value || null;
    commit();
  },
  itemField(el) {
    const it = state.items[el.dataset.sku];
    const f = el.dataset.field;
    if (['perUnit', 'minQty'].includes(f)) {
      const v = parseInput(el.value);
      it[f] = Number.isNaN(v) || v <= 0 ? (f === 'minQty' ? 0 : null) : v;
      if (f === 'perUnit' && it.perUnit && !it.subUnit) it.subUnit = 'pakke';
    } else {
      it[f] = el.value.trim();
      if (f === 'name' && !it.name) return;
    }
    commit();
  },
  itemFlag(el) {
    state.items[el.dataset.sku][el.dataset.flag] = el.checked;
    commit();
  },
  setting(el) {
    const v = parseInput(el.value);
    const f = el.dataset.field;
    const nullable = ['freeShippingMin', 'budgetYear'];
    state.settings[f] = Number.isNaN(v) || (nullable.includes(f) && v <= 0) ? (nullable.includes(f) ? null : state.settings[f]) : v;
    commit();
  },
  showVat(el) {
    state.settings.showVat = el.checked;
    commit();
  },
  async importFile(el) {
    const file = el.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const before = state.orders.length;
      state = mergeState(state, data);
      migrateItems();
      ui.importMsg = `Importert. ${state.orders.length - before} nye ordrer, ${state.orders.length} totalt.`;
      commit();
    } catch (e) {
      toast('Kunne ikke lese filen: ' + e.message);
    }
  },
};

document.addEventListener('click', (e) => {
  const tipEl = e.target.closest('[data-tip]');
  showTip(tipEl, e);
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.act];
  if (fn) fn(el, e);
});
document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-chg]');
  if (el && changes[el.dataset.chg]) changes[el.dataset.chg](el, e);
});
document.addEventListener('input', (e) => {
  if (e.target.dataset.input === 'filter') {
    const q = e.target.value.toLowerCase().trim();
    document.querySelectorAll('#itemList li').forEach((li) => (li.hidden = q && !li.dataset.name.includes(q)));
  }
});
document.addEventListener('pointerover', (e) => {
  if (e.pointerType === 'mouse') showTip(e.target.closest('[data-tip]'), e);
});

function showTip(el, e) {
  const tip = document.getElementById('tip');
  if (!el) {
    tip.hidden = true;
    return;
  }
  tip.textContent = el.dataset.tip;
  tip.hidden = false;
  const r = el.getBoundingClientRect();
  const w = tip.offsetWidth;
  const left = Math.min(window.innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2));
  tip.style.left = `${left}px`;
  tip.style.top = `${r.top + window.scrollY - tip.offsetHeight - 6}px`;
}

window.addEventListener('hashchange', render);

async function init() {
  state = normalize(await load());
  migrateItems();
  requestPersist();
  render();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
init();
