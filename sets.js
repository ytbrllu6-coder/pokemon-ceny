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

// Sety, ktoré vyšli, ale zdroje dát ich ešte nemajú. Len čo ich zdroj pridá, použijú sa jeho dáta (podľa názvu setu).
const fs = require('fs');
const path = require('path');
const MANUAL_SETS = [
  { id: 'manual:me6', name: 'Delta Reign', series: 'Mega Evolution', total: 103, date: '2026/11/06', code: 'ME6', file: 'delta-reign.txt', promoFile: 'delta-reign-promos.txt',
    image: (n) => `https://pokecottagecdn.com/mastersets/images/cards/me6-delta-reign-${String(n).padStart(3, '0')}-official-en-20261030__large.webp` },
];

function manualCards(set) {
  const lines = fs.readFileSync(path.join(__dirname, 'data', set.file), 'utf8').split('\n').filter(Boolean);
  return lines.map((l) => {
    const [number, name, rarity, flag] = l.split('|');
    return { id: `${set.id}-${number}`, name, number, rarity, image: set.image ? set.image(number) : null, avg30: null, reverse: null, noRh: flag === 'norh', trend: null, updated: null, cmUrl: null };
  });
}

// promo karty k setu (len pre ručne zadané sety); obrázok podľa vzoru z PokéCottage
function manualPromos(set) {
  if (!set.promoFile) return [];
  return fs.readFileSync(path.join(__dirname, 'data', set.promoFile), 'utf8').split('\n').filter(Boolean).map((l) => {
    const [number, name, img] = l.split('|');
    return { id: `${set.id}-${number.replace(/\s+/g, '').toLowerCase()}`, name, number, rarity: 'Promo', image: `https://pokecottagecdn.com/mastersets/images/cards/me6-delta-reign-${img}__large.webp`, avg30: null, reverse: null, trend: null, updated: null, cmUrl: null };
  });
}

function withManualSets(res) {
  const have = new Set(res.sets.map((s) => flat(s.name)));
  const extra = MANUAL_SETS.filter((m) => !have.has(flat(m.name))).map(({ file, image, promoFile, ...m }) => ({ ...m, logo: null, symbol: null }));
  return extra.length ? { ...res, sets: [...extra, ...res.sets] } : res;
}

async function listSets() {
  return withManualSets(await listSetsRaw());
}

async function listSetsRaw() {
  try {
    const json = await getJson(`${PTCG}/sets?orderBy=-releaseDate&pageSize=250&select=id,name,series,printedTotal,total,releaseDate,ptcgoCode,images`);
    const sets = (json.data || []).map(normSetPtcg);
    if (sets.length) return { source: 'pokemontcg', sets };
  } catch { /* skúsime zálohu */ }
  const list = await getJson(`${TCGDEX}/sets`);
  const ser = await dexSeries();
  const sets = (Array.isArray(list) ? list : []).map((d) => {
    const n = normSetDex(d);
    if (n.series === 'Ostatné') n.series = seriesOf(d.id, ser);
    return n;
  });
  return { source: 'tcgdex', sets: sets.reverse() };
}

// TCGdex v zozname setov sériu nevracia, preto ju skladáme zo zoznamu sérií (a pri chybe z predpony id setu)
const SERIES_BY_PREFIX = {
  me: 'Mega Evolution', sv: 'Scarlet & Violet', swsh: 'Sword & Shield', sm: 'Sun & Moon', xy: 'XY', bw: 'Black & White',
  hgss: 'HeartGold & SoulSilver', pl: 'Platinum', dp: 'Diamond & Pearl', ex: 'EX', neo: 'Neo', base: 'Base', gym: 'Gym', ecard: 'E-Card',
};
let dexSeriesCache = null;
async function dexSeries() {
  if (dexSeriesCache && Date.now() - dexSeriesCache.t < 6 * 3600 * 1000) return dexSeriesCache.map;
  const map = new Map();
  try {
    const series = await getJson(`${TCGDEX}/series`);
    await pool(Array.isArray(series) ? series : [], 6, async (x) => {
      const d = await getJson(`${TCGDEX}/series/${encodeURIComponent(x.id)}`);
      for (const st of d.sets || []) map.set(st.id, d.name || x.name);
    });
  } catch { /* použijeme predpony */ }
  if (map.size) dexSeriesCache = { t: Date.now(), map };
  return map;
}
const seriesOf = (id, map) => map.get(id) || SERIES_BY_PREFIX[(String(id).match(/^[a-z]+/i) || [''])[0].toLowerCase()] || 'Ostatné';

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
  if (!card.rarity && detail?.rarity) card.rarity = detail.rarity;
  if (!card.image && detail?.image) card.image = `${detail.image}/low.webp`;
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
  if (id.startsWith('manual:')) {
    const def = MANUAL_SETS.find((m) => m.id === id);
    if (!def) throw new Error('neznámy set');
    const mine = manualCards(def);
    result = { set, cards: mine, source: 'manual' };
    try {   // ak už set pozná TCGdex, vezmeme od neho obrázky (ceny sa doplnia nižšie); rarity ostávajú z nášho zoznamu
      const dex = await getJson(`${TCGDEX}/sets`);
      const match = (Array.isArray(dex) ? dex : []).find((d) => flat(d.name) === flat(def.name));
      if (match) {
        const img = new Map((await dexCards(match.id)).map((c) => [normNum(c.number), c.image]));
        for (const c of mine) c.image = img.get(normNum(c.number)) || c.image;
        result.source = 'tcgdex';
      }
    } catch { /* ostaneme pri vlastnom zozname */ }
  } else if (id.startsWith('tcgdex:')) {
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
  const man = MANUAL_SETS.find((m) => flat(m.name) === flat(set.name));
  if (man && result.source !== 'manual') {
    const mine = manualCards(man);
    const byNum = new Map(result.cards.map((c) => [normNum(c.number), c]));
    for (const m of mine) {
      const c = byNum.get(normNum(m.number));
      if (!c) { result.cards.push(m); continue; }
      c.rarity = c.rarity || m.rarity;
      c.image = c.image || m.image;
      if (m.noRh) c.noRh = true;
    }
  }
  if (man && man.promoFile) result.promos = manualPromos(man);
  const priced = result.cards.filter((c) => c.avg30).length;
  if (result.cards.length && priced < result.cards.length * 0.8) {
    await enrichPrices(set, result.cards).catch(() => {});
    if (result.source === 'tcgdex' && result.cards.some((c) => c.avg30)) result.source = 'tcgdex+ceny';
  }
  return result;
}

module.exports = { listSets, setCards };
