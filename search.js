'use strict';

const { SHOPS } = require('./shops');

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minút
const SHOP_TIMEOUT_MS = 9000;
const MIN_GAP_MS = 1000; // minimálny odstup medzi dvoma požiadavkami na ten istý obchod

// Skratky, ktoré zberatelia bežne používajú
const ALIASES = {
  etb: 'elite trainer box',
  upc: 'ultra premium collection',
  bb: 'booster box',
  spc: 'super premium collection',
};

function normalize(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function expandQuery(q) {
  return q
    .split(/\s+/)
    .map((w) => ALIASES[normalize(w)] || w)
    .join(' ')
    .trim();
}

// ---------- cache a spomalenie po obchodoch ----------

const cache = new Map(); // "shopId|query" -> { t, items }
const lastCall = new Map(); // shopId -> promise reťaz

function throttled(shopId, fn) {
  const prev = lastCall.get(shopId) || Promise.resolve();
  const run = prev.then(fn, fn);
  lastCall.set(
    shopId,
    run.then(
      () => new Promise((r) => setTimeout(r, MIN_GAP_MS)),
      () => new Promise((r) => setTimeout(r, MIN_GAP_MS))
    )
  );
  return run;
}

async function queryShop(shop, query) {
  const key = `${shop.id}|${normalize(query)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < CACHE_TTL_MS) return { items: hit.items, cached: true };

  const items = await throttled(shop.id, async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), SHOP_TIMEOUT_MS);
    try {
      return await shop.search(query, ctrl.signal);
    } finally {
      clearTimeout(timer);
    }
  });
  cache.set(key, { t: Date.now(), items });
  return { items, cached: false };
}

// ---------- hlavné vyhľadávanie ----------

function matches(title, tokens) {
  const t = normalize(title);
  return tokens.every((tok) => t.includes(tok));
}

async function searchAll(rawQuery, { pokemonOnly = true } = {}) {
  const query = expandQuery(rawQuery);
  const tokens = normalize(query).split(' ').filter(Boolean);

  const perShop = await Promise.all(
    SHOPS.map(async (shop) => {
      const started = Date.now();
      try {
        const { items, cached } = await queryShop(shop, query);
        return { shop, items, cached, ms: Date.now() - started, error: null };
      } catch (err) {
        const msg = err.name === 'AbortError' ? 'vypršal čas' : err.message;
        return { shop, items: [], cached: false, ms: Date.now() - started, error: msg };
      }
    })
  );

  const results = [];
  const shops = [];
  for (const r of perShop) {
    let kept = 0;
    for (const item of r.items) {
      if (!matches(item.title, tokens)) continue;
      if (pokemonOnly && !/pokemon/.test(normalize(item.title + ' ' + item.url))) continue;
      results.push({ ...item, shopId: r.shop.id, shopName: r.shop.name });
      kept++;
    }
    shops.push({
      id: r.shop.id,
      name: r.shop.name,
      url: r.shop.url,
      ok: !r.error,
      error: r.error,
      count: kept,
      cached: r.cached,
      ms: r.ms,
    });
  }

  // skladom najprv, v rámci toho od najlacnejšieho
  results.sort((a, b) => Number(b.inStock) - Number(a.inStock) || a.price - b.price);
  const firstInStock = results.find((x) => x.inStock);
  if (firstInStock) firstInStock.cheapest = true;

  return { query: rawQuery, expandedQuery: query, results, shops };
}

module.exports = { searchAll, normalize, expandQuery, matches };
