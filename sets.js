'use strict';

/**
 * Zoznam setov a karty v sete (podobne ako pokedata).
 * Hlavný zdroj: pokemontcg.io (sety aj karty s cenami z Cardmarketu). Ak neodpovedá, záloha: TCGdex (bez cien).
 */

const { normCard } = require('./cards');

const PTCG = 'https://api.pokemontcg.io/v2';
const TCGDEX = 'https://api.tcgdex.net/v2/en';
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const cache = new Map();

async function getJsonOnce(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  const headers = { Accept: 'application/json', 'User-Agent': 'PokemonCeny/1.0 (osobne-pouzitie)' };
  if (url.startsWith(PTCG) && process.env.POKEMONTCG_API_KEY) headers['X-Api-Key'] = process.env.POKEMONTCG_API_KEY;
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function getJson(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.t < CACHE_TTL_MS) return hit.json;
  let json;
  try {
    json = await getJsonOnce(url);
  } catch {
    await new Promise((r) => setTimeout(r, 1500));
    json = await getJsonOnce(url);
  }
  cache.set(url, { t: Date.now(), json });
  return json;
}

function normSetPtcg(s) {
  return {
    id: s.id,
    name: s.name,
    series: s.series || 'Ostatné',
    total: s.printedTotal || s.total || null,
    date: s.releaseDate ? String(s.releaseDate).replace(/\//g, '-') : null,
    logo: s.images?.logo || null,
    symbol: s.images?.symbol || null,
    code: s.ptcgoCode || null,
  };
}

function normSetDex(s) {
  return {
    id: 'tcgdex:' + s.id,
    name: s.name,
    series: s.serie?.name || 'Ostatné',
    total: s.cardCount?.official ?? s.cardCount?.total ?? null,
    date: s.releaseDate || null,
    logo: s.logo ? `${s.logo}.png` : null,
    symbol: s.symbol ? `${s.symbol}.png` : null,
    code: null,
  };
}

async function listSets() {
  try {
    const json = await getJson(`${PTCG}/sets?orderBy=-releaseDate&pageSize=250&select=id,name,series,printedTotal,total,releaseDate,ptcgoCode,images`);
    const sets = (json.data || []).map(normSetPtcg);
    if (sets.length) return { source: 'pokemontcg', sets };
  } catch { /* skúsime zálohu */ }
  const list = await getJson(`${TCGDEX}/sets`);
  return { source: 'tcgdex', sets: (Array.isArray(list) ? list : []).map(normSetDex).reverse() };
}

const flat = (t) => String(t || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');

async function dexCards(dexId) {
  const d = await getJson(`${TCGDEX}/sets/${encodeURIComponent(dexId)}`);
  return (d.cards || []).map((c) => ({
    id: 'tcgdex:' + c.id, name: c.name, number: String(c.localId ?? ''), rarity: null,
    image: c.image ? `${c.image}/low.webp` : null, avg30: null, trend: null, updated: null, cmUrl: null,
  }));
}

async function setCards(id) {
  const { sets } = await listSets();
  const set = sets.find((s) => s.id === id) || { id, name: id, series: '', total: null, date: null, logo: null, symbol: null, code: null };
  if (id.startsWith('tcgdex:')) return { set, cards: await dexCards(id.slice(7)), source: 'tcgdex' };
  try {
    const json = await getJson(`${PTCG}/cards?q=${encodeURIComponent('set.id:' + id)}&pageSize=250&select=id,name,number,rarity,set,cardmarket,images`);
    const cards = (json.data || []).map((c) => {
      const n = normCard(c);
      return { id: n.id, name: n.name, number: n.number, rarity: n.rarity, image: n.image, avg30: n.avg30, trend: n.trend, updated: n.updated, cmUrl: n.cmUrl };
    });
    if (cards.length) return { set, cards, source: 'pokemontcg' };
  } catch { /* skúsime zálohu */ }
  // záloha: set s rovnakým názvom v TCGdex (karty bez cien)
  const dex = await getJson(`${TCGDEX}/sets`);
  const match = (Array.isArray(dex) ? dex : []).find((d) => flat(d.name) === flat(set.name));
  if (!match) throw new Error('set sa nenašiel v zálohe');
  return { set, cards: await dexCards(match.id), source: 'tcgdex' };
}

module.exports = { listSets, setCards };
