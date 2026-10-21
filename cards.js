'use strict';

/**
 * Ceny jednotlivých kariet z Cardmarketu cez Pokémon TCG API (https://docs.pokemontcg.io).
 * API pri každej karte vracia cardmarket.prices (v €) vrátane 30-dňového priemeru (avg30).
 * Kľúč je voliteľný (zvyšuje denný limit): premenná prostredia POKEMONTCG_API_KEY.
 */

const API = 'https://api.pokemontcg.io/v2/cards';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const TIMEOUT_MS = 20000;
const cache = new Map();

// Prvé slovo z názvu, podľa ktorého sa hľadá (bez diakritiky, aspoň 3 písmená)
function firstToken(name) {
  const words =
    String(name || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .match(/[a-z]{3,}/g) || [];
  const stop = new Set(['basic', 'stage', 'the', 'and', 'hp']);
  return words.find((w) => !stop.has(w)) || null;
}

// Postupne menej prísne dotazy: názov+číslo+počet kariet v sete, číslo+počet, názov+číslo, len názov
// Skratky setov pri reprintoch: 30c = 30th Celebration (aj Classic Collection), 25c = Celebrations (CEL). Iné: kód setu (napr. OBF) alebo id (napr. sv3).
const SET_ALIASES = { '30c': '30C', '25c': 'CEL' };

function setClause(set) {
  const s = String(set || '').toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 12);
  if (!s) return null;
  if (SET_ALIASES[s]) return `set.ptcgoCode:${SET_ALIASES[s]}`;
  return /^[a-z]{2,5}$/.test(s) ? `set.ptcgoCode:${s.toUpperCase()}` : `set.id:${s}`;
}

function buildQueries({ name, number, total, set }) {
  const num = number != null && /^\d{1,3}$/.test(String(number)) && Number(number) > 0 ? String(Number(number)) : null;
  const tot = total != null && /^\d{2,3}$/.test(String(total)) && Number(total) > 0 ? String(Number(total)) : null;
  const tok = firstToken(name);
  const nameQ = tok ? `name:${tok}*` : null;
  const qs = [];
  if (nameQ && num && tot) qs.push(`${nameQ} number:${num} set.printedTotal:${tot}`);
  if (num && tot) qs.push(`number:${num} set.printedTotal:${tot}`);
  if (nameQ && num) qs.push(`${nameQ} number:${num}`);
  if (nameQ) qs.push(nameQ);
  const sc = setClause(set);
  if (sc) {
    // pri zadanom sete netreba počet kariet v sete, stačí meno a/alebo číslo
    const withSet = [];
    if (nameQ && num) withSet.push(`${nameQ} number:${num} ${sc}`);
    if (num) withSet.push(`number:${num} ${sc}`);
    if (nameQ) withSet.push(`${nameQ} ${sc}`);
    return [...new Set(withSet)];
  }
  return [...new Set(qs)];
}

const positive = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

function normCard(c) {
  const p = c.cardmarket?.prices || {};
  return {
    id: c.id,
    name: c.name,
    number: c.number,
    rarity: c.rarity || null,
    setName: c.set?.name || null,
    setTotal: c.set?.printedTotal ?? null,
    setCode: c.set?.ptcgoCode || null,
    image: c.images?.small || null,
    cmUrl: c.cardmarket?.url || null,
    updated: c.cardmarket?.updatedAt || null,
    avg30: positive(p.avg30),
    avg7: positive(p.avg7),
    avg1: positive(p.avg1),
    trend: positive(p.trendPrice),
    low: positive(p.lowPrice),
    reverseAvg30: positive(p.reverseHoloAvg30),
  };
}

async function fetchCards(q) {
  const hit = cache.get(q);
  if (hit && Date.now() - hit.t < CACHE_TTL_MS) return hit.cards;

  const url =
    `${API}?q=${encodeURIComponent(q)}&pageSize=12&orderBy=-set.releaseDate` +
    `&select=id,name,number,rarity,set,cardmarket,images`;
  const headers = { Accept: 'application/json', 'User-Agent': 'PokemonCeny/1.0 (osobne-pouzitie)' };
  if (process.env.POKEMONTCG_API_KEY) headers['X-Api-Key'] = process.env.POKEMONTCG_API_KEY;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const cards = (json.data || []).map(normCard);
    cache.set(q, { t: Date.now(), cards });
    return cards;
  } finally {
    clearTimeout(timer);
  }
}

async function findCards(input) {
  const queries = buildQueries(input);
  for (const q of queries) {
    const cards = await fetchCards(q);
    if (cards.length) return { cards, query: q };
  }
  return { cards: [], query: queries[queries.length - 1] || null };
}

module.exports = { findCards, buildQueries, normCard, firstToken };
