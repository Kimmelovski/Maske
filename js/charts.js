// Enkle SVG-diagrammer uten eksterne biblioteker (appen skal virke uten nett).
// Hvert punkt/stolpe har data-tip, som app.js viser som verktøytips ved trykk.

import { esc } from './util.js';

function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * p;
}

const shortNum = (v) =>
  v >= 1000 ? new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 1 }).format(v / 1000) + 'k' : String(Math.round(v));

// data: [{label, value, tip}]
export function barChart(data, { height = 170, ariaLabel = '' } = {}) {
  const W = 340;
  const H = height;
  const m = { l: 34, r: 6, t: 10, b: 22 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const max = niceMax(Math.max(...data.map((d) => d.value), 0));
  const band = iw / Math.max(1, data.length);
  const bw = Math.min(24, band * 0.7);
  const y = (v) => m.t + ih - (v / max) * ih;
  const grid = [0, 0.5, 1]
    .map((f) => {
      const v = max * f;
      return `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/>
        <text class="axis" x="${m.l - 6}" y="${y(v) + 3}" text-anchor="end">${shortNum(v)}</text>`;
    })
    .join('');
  const every = Math.ceil(data.length / 7);
  const bars = data
    .map((d, i) => {
      const cx = m.l + band * i + band / 2;
      const x = cx - bw / 2;
      const top = y(d.value);
      const h = m.t + ih - top;
      const r = Math.min(4, h, bw / 2);
      const path =
        h > 0
          ? `M${x},${m.t + ih} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${m.t + ih} Z`
          : '';
      const label = i % every === 0 || i === data.length - 1 ? `<text class="axis" x="${cx}" y="${H - 6}" text-anchor="middle">${esc(d.label)}</text>` : '';
      return `<g class="hit" data-tip="${esc(d.tip)}"><rect x="${m.l + band * i}" y="${m.t}" width="${band}" height="${ih}" fill="transparent"/>${path ? `<path class="bar" d="${path}"/>` : ''}</g>${label}`;
    })
    .join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(ariaLabel)}">${grid}${bars}</svg>`;
}

// data: [{label, value, tip}] i tidsrekkefølge
export function lineChart(data, { height = 150, ariaLabel = '' } = {}) {
  const W = 340;
  const H = height;
  const m = { l: 40, r: 12, t: 12, b: 22 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const vals = data.map((d) => d.value);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  const pad = Math.max((hi - lo) * 0.15, hi * 0.05, 1);
  lo = Math.max(0, lo - pad);
  hi = hi + pad;
  const x = (i) => (data.length === 1 ? m.l + iw / 2 : m.l + (i / (data.length - 1)) * iw);
  const y = (v) => m.t + ih - ((v - lo) / (hi - lo)) * ih;
  const grid = [lo, (lo + hi) / 2, hi]
    .map(
      (v) => `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/>
      <text class="axis" x="${m.l - 6}" y="${y(v) + 3}" text-anchor="end">${shortNum(v)}</text>`
    )
    .join('');
  const path = data.map((d, i) => `${i ? 'L' : 'M'}${x(i)},${y(d.value)}`).join(' ');
  const every = Math.ceil(data.length / 5);
  const pts = data
    .map(
      (d, i) => `<g class="hit" data-tip="${esc(d.tip)}"><circle cx="${x(i)}" cy="${y(d.value)}" r="14" fill="transparent"/><circle class="dot" cx="${x(i)}" cy="${y(d.value)}" r="4"/></g>
      ${i % every === 0 || i === data.length - 1 ? `<text class="axis" x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(d.label)}</text>` : ''}`
    )
    .join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(ariaLabel)}">${grid}<path class="line" d="${path}"/>${pts}</svg>`;
}
