// Leser tekst kopiert fra ordresiden på maske.no (Min side → Ordrehistorikk → ordre).
// Teksten kan komme med tabulatorer, linjeskift eller mellomrom mellom cellene
// avhengig av nettleser, så vi jobber på "ord" (tokens) og leter etter mønsteret
//   varenr  navn...  pris  antall  sum  mva  sum-inkl-mva
// og sjekker at pris × antall ≈ sum, slik at tall i varenavnet ikke lurer oss.

import { parseMoney, round2 } from './util.js';

const MONEY = /^\d{1,3}(\.\d{3})*,\d{2}$/;
const QTY = /^\d+(,\d+)?$/;
const SKU = /^\d{6,8}$/;

function isMoney(t) {
  return MONEY.test(t);
}

function matchLineAt(tokens, j) {
  const [p, q, s, v, si] = tokens.slice(j, j + 5);
  if (!(isMoney(p) && QTY.test(q ?? '') && isMoney(s) && isMoney(v) && isMoney(si))) return null;
  const price = parseMoney(p);
  const qty = parseMoney(q);
  const sum = parseMoney(s);
  const vat = parseMoney(v);
  const sumInc = parseMoney(si);
  // Tillat litt avrunding fra nettbutikken.
  if (Math.abs(price * qty - sum) > Math.max(0.05, sum * 0.005)) return null;
  if (Math.abs(sum + vat - sumInc) > 0.05) return null;
  return { price, qty, sum, vat, sumInc };
}

// Reserve når mva-kolonnene ikke er med i teksten (f.eks. hvis tabellen er kuttet):
// pris, antall og sum. Mva regnes da ut med 25 %.
function matchShortAt(tokens, j) {
  const [p, q, s, next] = tokens.slice(j, j + 4);
  if (!(isMoney(p) && QTY.test(q ?? '') && isMoney(s))) return null;
  if (next && isMoney(next)) return null; // da er det en vanlig linje med mva
  const price = parseMoney(p);
  const qty = parseMoney(q);
  const sum = parseMoney(s);
  if (Math.abs(price * qty - sum) > Math.max(0.05, sum * 0.005)) return null;
  const vat = round2(sum * 0.25);
  return { price, qty, sum, vat, sumInc: round2(sum + vat), vatEstimated: true, width: 3 };
}

export function parseMaskeOrder(text) {
  const clean = String(text || '').replace(/ /g, ' ');
  const flat = clean.replace(/\s+/g, ' ');
  const tokens = flat.split(' ').filter(Boolean);

  const header = {};
  const m = (re) => flat.match(re);
  let r;
  if ((r = m(/Ordrenr\.?:?\s+([A-Za-z]?\.?\d+)/i)) || (r = m(/Ordre:\s*([A-Za-z]?\.?\d+)/i))) header.id = r[1];
  if ((r = m(/Ordredato:?\s+(\d{1,2})\.(\d{1,2})\.(\d{4})/i))) {
    header.date = `${r[3]}-${r[2].padStart(2, '0')}-${r[1].padStart(2, '0')}`;
  }
  if ((r = m(/Referanse:?\s+(\S+)/))) header.reference = r[1];
  if ((r = m(/Totalt:?\s+(\d{1,3}(?:\.\d{3})*,\d{2})/))) header.total = parseMoney(r[1]);
  if ((r = m(/Herav mva\.?:?\s+(\d{1,3}(?:\.\d{3})*,\d{2})/i))) header.vat = parseMoney(r[1]);
  if ((r = m(/Frakt:?\s+(\d{1,3}(?:\.\d{3})*,\d{2})/))) header.freight = parseMoney(r[1]);

  const lines = [];
  for (let i = 0; i < tokens.length; i++) {
    if (!SKU.test(tokens[i])) continue;
    // Ikke tolk referansenummer o.l. som varenummer.
    const prev = (tokens[i - 1] || '').toLowerCase();
    if (prev.startsWith('referanse') || prev.startsWith('filial')) continue;
    for (let j = i + 2; j < Math.min(tokens.length - 2, i + 40); j++) {
      const hit = matchLineAt(tokens, j) || matchShortAt(tokens, j);
      if (hit) {
        const name = tokens.slice(i + 1, j).join(' ').trim();
        if (name && !SKU.test(name)) {
          const { width = 5, ...line } = hit;
          lines.push({ sku: tokens[i], name, ...line });
          i = j + width - 1;
        }
        break;
      }
      // Et nytt varenummer før vi fant tallene betyr at dette ikke var en varelinje.
      if (SKU.test(tokens[j]) && j > i + 1) break;
    }
  }

  const linesSum = round2(lines.reduce((a, l) => a + l.sum, 0));
  const linesSumInc = round2(lines.reduce((a, l) => a + l.sumInc, 0));
  const linesVat = round2(lines.reduce((a, l) => a + l.vat, 0));
  const vatEstimated = lines.some((l) => l.vatEstimated);
  const warnings = [];
  if (!header.id) warnings.push('Fant ikke ordrenummer.');
  if (!header.date) warnings.push('Fant ikke ordredato.');
  if (!lines.length) warnings.push('Fant ingen varelinjer.');
  if (header.total != null && lines.length) {
    const expected = round2(header.total - (header.freight || 0));
    // Utregnet mva kan avvike noen øre per linje fra Maskes avrunding.
    const tol = vatEstimated ? Math.max(0.1, lines.length * 0.03) : 0.1;
    if (Math.abs(expected - linesSumInc) > tol) {
      warnings.push(
        `Summen av varelinjene (${linesSumInc.toFixed(2)} inkl. mva) stemmer ikke med totalen (${expected.toFixed(2)}). Mangler det linjer?`
      );
    }
  }
  return { ...header, lines, linesSum, linesVat, linesSumInc, vatEstimated, warnings, ok: lines.length > 0 && warnings.length === 0 };
}
