// Små hjelpefunksjoner for datoer, tall og tekst.

const pad = (n) => String(n).padStart(2, '0');

export function toISO(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayISO() {
  return toISO(new Date());
}

export function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function daysBetween(a, b) {
  return Math.round((parseISO(b) - parseISO(a)) / 86400000);
}

export function addDays(s, n) {
  const d = parseISO(s);
  d.setDate(d.getDate() + Math.round(n));
  return toISO(d);
}

export function fmtDate(s) {
  if (!s) return '–';
  const [y, m, d] = s.split('-');
  return `${d}.${m}.${y}`;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des'];
export function monthLabel(ym) {
  const [y, m] = ym.split('-');
  return `${MONTHS[Number(m) - 1]} ${y.slice(2)}`;
}

export function fmtNum(x, maxDec = 1) {
  if (x == null || Number.isNaN(x)) return '–';
  return new Intl.NumberFormat('nb-NO', { maximumFractionDigits: maxDec }).format(x);
}

export function fmtKr(x, dec = 0) {
  if (x == null || Number.isNaN(x)) return '–';
  return new Intl.NumberFormat('nb-NO', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(x) + ' kr';
}

// Beløp slik Maske viser dem: "1.296,44"
export function parseMoney(s) {
  if (typeof s === 'number') return s;
  return Number(String(s).replace(/\s| /g, '').replace(/\./g, '').replace(',', '.'));
}

// Tall skrevet inn av brukeren: godtar både komma og punktum som desimaltegn.
export function parseInput(s) {
  if (s == null) return NaN;
  const t = String(s).trim().replace(/\s/g, '').replace(',', '.');
  if (t === '') return NaN;
  return Number(t);
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const round2 = (x) => Math.round(x * 100) / 100;
