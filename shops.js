'use strict';

/**
 * Adaptéry obchodov.
 *
 * Každý obchod má metódu search(query, signal) -> pole produktov:
 *   { title, price (číslo v EUR), url, image, inStock }
 *
 * Používame len verejné vyhľadávacie rozhrania, ktoré robots.txt daného obchodu
 * nezakazuje (Shopify /search/suggest.json a WooCommerce Store API).
 * Nový obchod pridáš na konci súboru do poľa SHOPS - stačí `shopify(...)` alebo `woocommerce(...)`.
 */

const { decodeEntities } = require('./text');
const { listingShop } = require('./listing');

const UA = 'Mozilla/5.0 (compatible; PokemonCeny/1.0; osobne-pouzitie)';

async function getJson(url, signal) {
  const res = await fetch(url, {
    signal,
    headers: { 'User-Agent': UA, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ---------- parsery (exportované kvôli testom) ----------

function parseShopify(json, base) {
  const products = json?.resources?.results?.products || [];
  return products
    .map((p) => ({
      title: decodeEntities(p.title || ''),
      price: parseFloat(p.price),
      url: base + String(p.url || '').split('?')[0],
      image: p.image || p.featured_image?.url || null,
      inStock: p.available === true,
    }))
    .filter((p) => p.title && Number.isFinite(p.price) && p.price > 0);
}

function parseWoo(json) {
  if (!Array.isArray(json)) return [];
  return json
    .map((p) => {
      const minor = Number(p.prices?.currency_minor_unit ?? 2);
      const price = Number(p.prices?.price) / 10 ** minor;
      return {
        title: decodeEntities(p.name || ''),
        price,
        url: p.permalink,
        image: p.images?.[0]?.thumbnail || p.images?.[0]?.src || null,
        inStock: p.is_in_stock === true,
      };
    })
    .filter((p) => p.title && Number.isFinite(p.price) && p.price > 0);
}

// ---------- továreň na adaptéry ----------

function shopify({ id, name, base }) {
  return {
    id,
    name,
    url: base,
    async search(query, signal) {
      const url =
        `${base}/search/suggest.json?q=${encodeURIComponent(query)}` +
        `&resources[type]=product&resources[limit]=10` +
        `&resources[options][unavailable_products]=last`;
      return parseShopify(await getJson(url, signal), base);
    },
  };
}

// WooCommerce obchod stiahne celý katalóg (je malý) a filtrovanie prebehne u nás,
// takže funguje aj tolerancia preklepov. Katalóg sa cachuje (pozri search.js).
function woocommerce({ id, name, base }) {
  return {
    id,
    name,
    url: base,
    catalog: true,
    async search(_query, signal) {
      const all = [];
      for (let page = 1; page <= 5; page++) {
        const url = `${base}/wp-json/wc/store/v1/products?per_page=100&page=${page}`;
        const batch = await getJson(url, signal);
        if (!Array.isArray(batch)) break;
        all.push(...parseWoo(batch));
        if (batch.length < 100) break;
      }
      return all;
    },
  };
}

// ---------- zoznam obchodov ----------

const SHOPS = [
  shopify({ id: 'cardyx', name: 'CardyX', base: 'https://www.cardyx.sk' }),
  shopify({ id: '64ka', name: '64ka', base: 'https://www.64ka.sk' }),
  woocommerce({ id: '365tcg', name: '365TCG', base: 'https://365tcg.sk' }),
  // Obchody bez API: výpis Pokémon kategórie sa sťahuje na pozadí (pozri listing.js)
  listingShop({
    id: 'ihrysko',
    name: 'iHRYsko',
    base: 'https://www.ihrysko.sk',
    pageUrl: (p) => `https://www.ihrysko.sk/pokemon-tcg-c17668${p > 1 ? `?page=${p}` : ''}`,
    linkRe: /-p\d+$/,
    maxPages: 60,
    ttlMs: 3 * 60 * 60 * 1000,
  }),
  listingShop({
    id: 'smarty',
    name: 'Smarty',
    base: 'https://www.smarty.sk',
    pageUrl: (p) => `https://www.smarty.sk/Produkty/pokemon-karty${p > 1 ? `?pg=${p}` : ''}`,
    linkRe: /-\d+p\d+$/,
    maxPages: 15,
    ttlMs: 30 * 60 * 1000,
  }),
];

module.exports = { SHOPS, parseShopify, parseWoo, decodeEntities };
