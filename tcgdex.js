'use strict';

/**
 * Záložný zdroj cien z Cardmarketu: TCGdex (https://tcgdex.dev), ktorý má ceny aj pre novšie sety,
 * pre ktoré pokemontcg.io cenu nevracia. Používa sa len ak je číslo karty známe.
 */

const API = 'https://api.tcgdex.net/v2/en';
const TIMEOUT_MS = 12000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map();

const positive = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

function normTcgdex(c) {
  const cm = c.pricing?.cardmarket || {};
  return {
    id: 'tcgdex:' + c.id,
    name: c.name,
    number: String(c.localId ?? ''),
    rarity: c.rarity || null,
    setName: c.set?.name || null,
    setTotal: c.set?.cardCount?.official ?? null,
    setCode: c.set?.id ? String(c.set.id).toUpperCase() : null,
    image: c.image ? `${c.image}/low.webp` : null,
    cmUrl: null,
    updated: cm.updated ? String(cm.updated).slice(0, 10) : null,
    avg30: positive(cm.avg30),
    avg7: positive(cm.avg7),
    avg1: positive(cm.avg1),
    trend: positive(cm.trend),
    low: positive(cm.low),
    reverseAvg30: positive(cm['avg30-holo']),
  };
}

async function getJson(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.t < CACHE_TTL_MS) return hit.json;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json', 'User-Agent': 'PokemonCeny/1.0 (osobne-pouzitie)' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    cache.set(url, { t: Date.now(), json });
    return json;
  } finally {
    clearTimeout(timer);
  }
}

// názov + číslo karty -> karty s cenami (najviac 8)
async function findTcgdex({ name, number }) {
  const num = number != null && /^\d{1,3}$/.test(String(number)) ? String(Number(number)) : null;
  if (!num) return [];
  const q = new URLSearchParams({ localId: num });
  if (name) q.set('name', String(name).slice(0, 60));
  const list = await getJson(`${API}/cards?${q}`);
  if (!Array.isArray(list)) return [];
  const ids = list.slice(-8).map((c) => c.id).filter(Boolean); // najnovšie sety sú na konci
  const details = await Promise.all(ids.map((id) => getJson(`${API}/cards/${encodeURIComponent(id)}`).catch(() => null)));
  return details.filter(Boolean).map(normTcgdex);
}

module.exports = { findTcgdex, normTcgdex };
