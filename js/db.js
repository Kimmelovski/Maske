// Lagring lokalt på telefonen (IndexedDB). Ingenting sendes til noen server.

import { DEFAULT_SETTINGS } from './calc.js';

const DB = 'maske-bestilling';
const STORE = 'kv';
const KEY = 'state';

export function emptyState() {
  return { version: 1, items: {}, orders: [], counts: [], draft: {}, settings: { ...DEFAULT_SETTINGS } };
}

export function normalize(s) {
  const base = emptyState();
  const out = { ...base, ...(s || {}) };
  out.settings = { ...DEFAULT_SETTINGS, ...(s?.settings || {}) };
  out.items = out.items || {};
  out.orders = Array.isArray(out.orders) ? out.orders : [];
  out.counts = Array.isArray(out.counts) ? out.counts : [];
  out.draft = out.draft || {};
  return out;
}

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function load() {
  try {
    const db = await open();
    const val = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const r = tx.objectStore(STORE).get(KEY);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    return normalize(val);
  } catch (e) {
    console.error('Kunne ikke lese data', e);
    return emptyState();
  }
}

export async function save(state) {
  const db = await open();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(JSON.parse(JSON.stringify(state)), KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

// Be nettleseren om ikke å slette dataene automatisk ved lite lagringsplass.
export async function requestPersist() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {}
}

// Slår sammen data fra en sikkerhetskopi/importfil med det som finnes.
export function mergeState(current, incoming) {
  const inc = normalize(incoming);
  const out = normalize(JSON.parse(JSON.stringify(current)));
  for (const [sku, item] of Object.entries(inc.items)) {
    const cur = out.items[sku];
    out.items[sku] = cur ? { ...item, ...cur } : item;
    if (cur && /navn mangler/.test(cur.name) && item.name && !/navn mangler/.test(item.name)) out.items[sku].name = item.name;
  }
  for (const o of inc.orders) {
    const i = out.orders.findIndex((x) => x.id === o.id);
    if (i >= 0) out.orders[i] = o;
    else out.orders.push(o);
  }
  for (const c of inc.counts) {
    const existing = out.counts.find((x) => x.date === c.date);
    if (existing) existing.entries = { ...c.entries, ...existing.entries };
    else out.counts.push(c);
  }
  return out;
}
