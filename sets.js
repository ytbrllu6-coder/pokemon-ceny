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
    image: c.image ? `${c.image}/low.webp` : null, avg30: null, reverse: null, trend: null, updated: null, cmUrl: null,
  }));
}

const normNum = (n) => String(n ?? '').toLowerCase().replace(/^0+(?=\d)/, '');

// paralelné spracovanie so stropom (nezaťažíme TCGdex stovkami požiadaviek naraz)
async function pool(items, size, fn) {
  let k = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (k < items.length) await fn(items[k++]);
  }));
}

function applyPricing(card, detail) {
  const cm = detail?.pricing?.cardmarket;
  if (!cm) return;
  if (cm['avg30-holo'] > 0) card.reverse = cm['avg30-holo'];
  if (!(cm.avg30 > 0)) return;
  card.avg30 = cm.avg30;
  card.trend = cm.trend > 0 ? cm.trend : card.trend;
  card.updated = cm.updated ? String(cm.updated).slice(0, 10) : card.updated;
}

// karty bez ceny doplní z TCGdex (cena je pri každej karte zvlášť, preto limit času; zvyšok sa dopĺňa pri ďalších návštevách z pamäte)
async function enrichPrices(set, cards) {
  const missing = cards.filter((c) => !c.avg30);
  if (!missing.length) return;
  const deadline = Date.now() + 25000;
  let byNum = null;
  if (!cards[0].id.startsWith('tcgdex:')) {
    const dex = await getJson(`${TCGDEX}/sets`);
    const match = (Array.isArray(dex) ? dex : []).find((d) => flat(d.name) === flat(set.name));
    if (!match) return;
    const d = await getJson(`${TCGDEX}/sets/${encodeURIComponent(match.id)}`);
    byNum = new Map((d.cards || []).map((c) => [normNum(c.localId), c.id]));
  }
  await pool(missing, 8, async (card) => {
    if (Date.now() > deadline) return;
    const dexId = byNum ? byNum.get(normNum(card.number)) : card.id.slice(7);
    if (!dexId) return;
    const detail = await getJson(`${TCGDEX}/cards/${encodeURIComponent(dexId)}`).catch(() => null);
    applyPricing(card, detail);
  });
}

// Doplní karty, ktoré pokemontcg.io pri (zvyčajne novom) sete ešte nemá, ale TCGdex ich pozná (podľa čísla karty).
async function addMissingFromDex(set, cards) {
  const dex = await getJson(`${TCGDEX}/sets`);
  const match = (Array.isArray(dex) ? dex : []).find((d) => flat(d.name) === flat(set.name));
  if (!match) return;
  const have = new Set(cards.map((c) => normNum(c.number)));
  const extra = (await dexCards(match.id)).filter((c) => !have.has(normNum(c.number)));
  cards.push(...extra);
}

async function setCards(id) {
  const { sets } = await listSets();
  const set = sets.find((s) => s.id === id) || { id, name: id, series: '', total: null, date: null, logo: null, symbol: null, code: null };
  let result = null;
  if (id.startsWith('tcgdex:')) {
    result = { set, cards: await dexCards(id.slice(7)), source: 'tcgdex' };
  } else {
    try {
      // pokemontcg.io vracia max. 250 kariet na stranu, väčšie sety (secret rare) treba načítať po stranách
      const raw = [];
      for (let page = 1; page <= 4; page++) {
        const json = await getJson(`${PTCG}/cards?q=${encodeURIComponent('set.id:' + id)}&pageSize=250&page=${page}&select=id,name,number,rarity,set,cardmarket,images`);
        const part = json.data || [];
        raw.push(...part);
        if (!part.length || raw.length >= (json.totalCount || 0)) break;
      }
      const cards = raw.map((c) => {
        const n = normCard(c);
        return { id: n.id, name: n.name, number: n.number, rarity: n.rarity, image: n.image, avg30: n.avg30, reverse: n.reverseAvg30, trend: n.trend, updated: n.updated, cmUrl: n.cmUrl };
      });
      if (cards.length) {
        result = { set, cards, source: 'pokemontcg' };
        await addMissingFromDex(set, cards).catch(() => {});   // pri novom sete môže pokemontcg.io mať len časť kariet
      }
    } catch { /* skúsime zálohu */ }
    if (!result) {
      // záloha: set s rovnakým názvom v TCGdex
      const dex = await getJson(`${TCGDEX}/sets`);
      const match = (Array.isArray(dex) ? dex : []).find((d) => flat(d.name) === flat(set.name));
      if (!match) throw new Error('set sa nenašiel v zálohe');
      result = { set, cards: await dexCards(match.id), source: 'tcgdex' };
    }
  }
  const priced = result.cards.filter((c) => c.avg30).length;
  if (result.cards.length && priced < result.cards.length * 0.8) {
    await enrichPrices(set, result.cards).catch(() => {});
    if (result.source === 'tcgdex' && result.cards.some((c) => c.avg30)) result.source = 'tcgdex+ceny';
  }
  return result;
}

module.exports = { listSets, setCards };
