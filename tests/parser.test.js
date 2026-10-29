import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMaskeOrder } from '../js/parser.js';
import { tabText, newlineText, expectedLines } from './fixtures.js';

for (const [name, text] of [['tabulatorer', tabText], ['linjeskift', newlineText]]) {
  test(`leser ordre kopiert med ${name}`, () => {
    const r = parseMaskeOrder(text);
    assert.equal(r.id, 'w.853448');
    assert.equal(r.date, '2026-10-27');
    assert.equal(r.reference, '55184079');
    assert.equal(r.total, 4433);
    assert.equal(r.vat, 886.63);
    assert.equal(r.freight, 0);
    assert.equal(r.lines.length, 10);
    assert.deepEqual(r.lines.map((l) => l.sku), expectedLines.map((l) => l[0]));
    assert.deepEqual(r.lines.map((l) => l.name), expectedLines.map((l) => l[1]));
    assert.equal(r.lines[2].sum, 1296.44);
    assert.equal(r.lines[2].qty, 4);
    assert.equal(r.linesSum, 3546.37);
    assert.deepEqual(r.warnings, []);
    assert.ok(r.ok);
  });
}

test('varsler når linjer mangler', () => {
  const cut = tabText.split('\n').filter((l) => !l.startsWith('3359297')).join('\n');
  const r = parseMaskeOrder(cut);
  assert.equal(r.lines.length, 9);
  assert.ok(r.warnings.some((w) => w.includes('stemmer ikke')));
  assert.equal(r.ok, false);
});

test('tom tekst gir advarsler, ikke feil', () => {
  const r = parseMaskeOrder('');
  assert.equal(r.lines.length, 0);
  assert.ok(r.warnings.length >= 2);
});

test('tåler tekst uten mva-kolonner og regner ut mva', () => {
  const short = tabText.replace(/^(\d{7} .+?\t[\d.,]+\t\d+\t[\d.,]+)\t[\d.,]+\t[\d.,]+$/gm, '$1');
  const r = parseMaskeOrder(short);
  assert.equal(r.lines.length, 10);
  assert.equal(r.linesSum, 3546.37);
  assert.ok(r.vatEstimated);
  assert.ok(Math.abs(r.linesSumInc - 4433) < 0.3);
  assert.deepEqual(r.warnings, []);
});

test('mva fra siden summeres', () => {
  const r = parseMaskeOrder(tabText);
  assert.equal(r.linesVat, 886.63);
  assert.equal(r.linesSumInc, 4433);
  assert.equal(r.vatEstimated, false);
});
