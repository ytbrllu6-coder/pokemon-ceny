'use strict';

const { SHOPS } = require('./shops');
const external = require('./external');

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

// Bežné slová z názvov produktov - slúžia na automatickú opravu preklepov (napr. "bandle" -> "bundle")
const DICT = [
  'booster', 'bundle', 'elite', 'trainer', 'box', 'collection', 'premium', 'ultra', 'super', 'tin', 'blister',
  'display', 'pack', 'case', 'sleeved', 'build', 'battle', 'stadium', 'celebration', 'evolutions', 'album',
  'binder', 'deck', 'starter', 'promo', 'mega', 'ascended', 'heroes', 'prismatic', 'destined', 'rivals',
  'surging', 'sparks', 'journey', 'together', 'chaos', 'rising', 'perfect', 'order', 'phantasmal', 'flames',
  'black', 'bolt', 'white', 'flare', 'scarlet', 'violet', 'paldea', 'obsidian', 'paradox', 'temporal',
  'forces', 'twilight', 'masquerade', 'stellar', 'crown', 'shrouded', 'fable', 'pitch', 'charizard', 'pikachu',
  'pokemon', 'sleeves', 'japanese', 'korean',
];

function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

function correctQuery(q) {
  return q
    .split(/\s+/)
    .map((w) => {
      const n = normalize(w);
      if (n.length < 4 || DICT.includes(n)) return w;
      const near = DICT.filter((d) => lev(n, d) <= 1);
      return near.length === 1 ? near[0] : w;
    })
    .join(' ');
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

// Obchody sťahované na pozadí (listing.js): odpoveď je vždy okamžitá z pamäte,
// obnova beží samostatne. Pri prvom spustení sa katalóg ešte sťahuje.
const crawls = new Map(); // shopId -> { items, t, loading, retryAt, error }

function backgroundItems(shop) {
  let st = crawls.get(shop.id);
  if (!st) {
    st = { items: null, t: 0, loading: false, retryAt: 0, error: null };
    crawls.set(shop.id, st);
  }
  const stale = !st.items || Date.now() - st.t > shop.ttlMs;
  if (stale && !st.loading && Date.now() >= st.retryAt) {
    st.loading = true;
    shop
      .crawl()
      .then((items) => {
        st.items = items;
        st.t = Date.now();
        st.error = null;
      })
      .catch((err) => {
        st.error = err.message;
        st.retryAt = Date.now() + 5 * 60 * 1000; // po chybe skúsime znova o 5 minút
      })
      .finally(() => {
        st.loading = false;
      });
  }
  if (st.items) return { items: st.items, cached: true };
  const err = new Error(st.loading ? 'práve sa načítava' : st.error || 'zatiaľ nenačítané');
  err.loading = st.loading;
  throw err;
}

function warmUp() {
  for (const shop of SHOPS) {
    if (!shop.background) continue;
    try {
      backgroundItems(shop);
    } catch {
      /* očakávané: katalóg sa ešte sťahuje */
    }
  }
}

async function queryShop(shop, query) {
  if (shop.background) return backgroundItems(shop);
  const key = shop.catalog ? `${shop.id}|*` : `${shop.id}|${normalize(query)}`;
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
  const words = t.split(' ');
  return tokens.every((tok) => {
    // krátke slová (tin, ex, v) musia začínať slovo, inak by sa našli aj vo vnútri iných ("des-tin-ed")
    if (tok.length <= 3) return words.some((w) => w.startsWith(tok));
    if (t.includes(tok)) return true;
    // tolerancia jedného preklepu pri dlhších slovách
    return tok.length >= 5 && words.some((w) => lev(tok, w) <= 1);
  });
}

async function searchAll(rawQuery, { pokemonOnly = true } = {}) {
  const query = correctQuery(expandQuery(rawQuery));
  const tokens = normalize(query).split(' ').filter(Boolean);

  const perShop = await Promise.all(
    SHOPS.map(async (shop) => {
      const started = Date.now();
      try {
        const { items, cached } = await queryShop(shop, query);
        return { shop, items, cached, ms: Date.now() - started, error: null };
      } catch (err) {
        const msg = err.name === 'AbortError' ? 'vypršal čas' : err.message;
        return { shop, items: [], cached: false, ms: Date.now() - started, error: msg, loading: Boolean(err.loading) };
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
      loading: Boolean(r.loading),
      error: r.error,
      count: kept,
      cached: r.cached,
      ms: r.ms,
    });
  }

  // ponuky nahrané majiteľom (napr. Smarty)
  for (const id of external.ids()) {
    const ext = external.get(id);
    if (!ext) continue;
    const found = ext.items.filter((item) => matches(item.title, tokens));
    for (const item of found) results.push({ ...item, shopId: id, shopName: external.name(id) });
    shops.push({ id, name: `${external.name(id)} (stav z ${new Date(ext.at).toLocaleDateString('sk-SK')})`, url: '', ok: true, loading: false, error: null, count: found.length, cached: true, ms: 0 });
  }

  // skladom najprv, v rámci toho od najlacnejšieho
  results.sort((a, b) => Number(b.inStock) - Number(a.inStock) || a.price - b.price);
  const firstInStock = results.find((x) => x.inStock);
  if (firstInStock) firstInStock.cheapest = true;

  return { query: rawQuery, expandedQuery: query, results, shops };
}

// ---------- súvisiace produkty (ten istý typ a edícia) ----------

// Konkrétne edície (hľadajú sa od najdlhšieho názvu). Zoznam treba občas doplniť o nové edície.
const SETS = [
  'Chaos Rising', 'Perfect Order', 'Pitch Black', 'Phantasmal Flames', 'Ascended Heroes', '30th Celebration',
  'Black Bolt', 'White Flare', 'Destined Rivals', 'Journey Together', 'Prismatic Evolutions', 'Surging Sparks',
  'Stellar Crown', 'Shrouded Fable', 'Twilight Masquerade', 'Temporal Forces', 'Paldean Fates', 'Paradox Rift',
  'Obsidian Flames', 'Paldea Evolved', '151', 'Crown Zenith', 'Silver Tempest', 'Lost Origin', 'Astral Radiance',
  'Brilliant Stars', 'Fusion Strike', 'Celebrations', 'Evolving Skies', 'Chilling Reign', 'Battle Styles',
  'Shining Fates', 'Vivid Voltage', "Champion's Path", 'Darkness Ablaze', 'Rebel Clash', 'Hidden Fates',
  'Cosmic Eclipse', 'Unified Minds', 'Team Up', 'Burning Shadows',
];
// Základné série: použijú sa, až keď sa nenájde konkrétna edícia
const BASE_SETS = ['Mega Evolution', 'Scarlet & Violet', 'Sword & Shield', 'Sun & Moon'];

const TYPES = [
  { id: 'etb', label: 'Elite Trainer Boxy', query: 'elite trainer box', re: /elite trainer box|\betb\b/ },
  { id: 'bundle', label: 'Booster Bundle', query: 'booster bundle', re: /booster bundle/ },
  { id: 'box', label: 'Booster Boxy', query: 'booster box', re: /booster box|booster display|\bdisplay\b/ },
  { id: 'tin', label: 'Tinky', query: 'tin', re: /\b(tin|tins|tinka|tinky|plechovk\w*)\b/ },
  { id: 'blister', label: 'Blistre', query: 'blister', re: /blister/ },
  { id: 'collection', label: 'Kolekcie', query: 'collection', re: /collection|kolekci/ },
  { id: 'deck', label: 'Decky', query: 'deck', re: /\bdeck\b/ },
  { id: 'booster', label: 'Boostre', query: 'booster', re: /booster/, not: /bundle|box|blister|display|collection/ },
];

function typeOk(type, normTitle) {
  return type.re.test(normTitle) && !(type.not && type.not.test(normTitle));
}

function detect(title) {
  const n = normalize(title);
  const padded = ` ${n} `;
  const has = (name) => padded.includes(` ${normalize(name)} `);
  const type = TYPES.find((t) => typeOk(t, n)) || null;
  const edition =
    SETS.filter(has).sort((a, b) => b.length - a.length)[0] ||
    BASE_SETS.find(has) ||
    (/\bmega\b/.test(n) ? 'Mega Evolution' : null);
  return { type, edition };
}

async function related(title) {
  const { type, edition } = detect(title);
  if (!type) return { type: null, edition, results: [], shops: [] };
  const query = [edition, type.query].filter(Boolean).join(' ');
  const out = await searchAll(query);
  const results = out.results.filter((r) => typeOk(type, normalize(r.title))).slice(0, 80);
  return { type: type.id, typeLabel: type.label, edition, query, results, shops: out.shops };
}

// ---------- ukážkové produkty na úvodnej stránke ----------

const FEATURED = [
  { title: 'Elite Trainer Boxy', q: 'elite trainer box' },
  { title: 'Booster Bundle', q: 'booster bundle' },
  { title: 'Booster Boxy', q: 'booster box' },
  { title: 'Kolekcie a tiny', q: 'collection' },
];
let featuredCache = null;

async function featured() {
  if (featuredCache && Date.now() - featuredCache.t < CACHE_TTL_MS) return featuredCache.data;
  const data = [];
  for (const cat of FEATURED) {
    const { results } = await searchAll(cat.q);
    const items = results.filter((r) => r.inStock).slice(0, 4);
    if (items.length) data.push({ title: cat.title, q: cat.q, items });
  }
  if (data.length) featuredCache = { t: Date.now(), data };
  return data;
}

module.exports = { related, detect, warmUp, featured, searchAll, normalize, expandQuery, correctQuery, matches };
