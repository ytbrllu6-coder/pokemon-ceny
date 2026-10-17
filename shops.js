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

const UA = 'Mozilla/5.0 (compatible; PokemonCeny/1.0; osobne-pouzitie)';

function decodeEntities(str) {
  return String(str)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&apos;/g, "'");
}

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

function woocommerce({ id, name, base }) {
  return {
    id,
    name,
    url: base,
    async search(query, signal) {
      const url = `${base}/wp-json/wc/store/v1/products?search=${encodeURIComponent(query)}&per_page=30`;
      return parseWoo(await getJson(url, signal));
    },
  };
}

// ---------- zoznam obchodov ----------

const SHOPS = [
  shopify({ id: 'cardyx', name: 'CardyX', base: 'https://www.cardyx.sk' }),
  shopify({ id: '64ka', name: '64ka', base: 'https://www.64ka.sk' }),
  woocommerce({ id: '365tcg', name: '365TCG', base: 'https://365tcg.sk' }),
];

module.exports = { SHOPS, parseShopify, parseWoo, decodeEntities };
