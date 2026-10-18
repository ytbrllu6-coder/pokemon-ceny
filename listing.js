'use strict';

/**
 * Obchody bez verejného vyhľadávacieho API (Smarty, iHRYsko).
 *
 * Z obchodu sa pravidelne na pozadí stiahne výpis Pokémon kategórie (všetky strany, 1 požiadavka za sekundu),
 * produkty sa z HTML vyčítajú a hľadá sa v nich u nás. Stránky vyhľadávania sa nepoužívajú.
 *
 * Parser nezávisí od CSS tried: nájde odkazy na produkty (podľa tvaru URL) a z textu medzi nimi
 * vyberie názov, cenu, dostupnosť a obrázok. Ak sa web zmení a nič sa nenájde, obchod sa označí ako nedostupný.
 */

const { decodeEntities } = require('./text');

const UA = 'Mozilla/5.0 (compatible; PokemonCeny/1.0; osobne-pouzitie)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const NEGATIVE_STOCK =
  /nedostupn|vypredan|nie je skladom|nie je na sklade|o[cč]ak[aá]vame|pripravujeme|predobjedn|dlhodobo|do[cč]asne|iba na predajn|len na predajn|len v predajn|pouze na prodejn|na vy[zž]iadanie/i;
const POSITIVE_STOCK = /na sklade|skladom|ihne[dď]|expedujeme|odosielame|dostupn/i;
const PRICE_RE = /(\d{1,3}(?:[ .]\d{3})+|\d+)(?:,(\d{1,2}))?\s*(?:€|eur\b)/gi;

function htmlToText(html) {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|del|s|strike)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function attr(tag, name) {
  const m = new RegExp('\\b' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')', 'i').exec(tag);
  return m ? decodeEntities(m[1] ?? m[2] ?? '') : '';
}

function absUrl(href, base) {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

function pickPrice(text) {
  const found = [];
  PRICE_RE.lastIndex = 0;
  let m;
  while ((m = PRICE_RE.exec(text))) {
    const after = text.slice(PRICE_RE.lastIndex, PRICE_RE.lastIndex + 14);
    const before = text.slice(Math.max(0, m.index - 22), m.index);
    if (/^\s*bez\s*dph/i.test(after)) continue; // cena bez DPH
    if (/(u[sš]etr[ií]te|u[sš]etr[ií]š|zľav\w*|zlav\w*|po[sš]tovn\w*|doprav\w*)\s*:?\s*$/i.test(before)) continue;
    const value = parseFloat(m[1].replace(/[ .]/g, '') + '.' + (m[2] || '0'));
    if (value >= 0.5 && value <= 5000) found.push(value);
  }
  return found.length ? Math.min(...found) : NaN;
}

function pickStock(text) {
  if (NEGATIVE_STOCK.test(text)) return false;
  return POSITIVE_STOCK.test(text);
}

function slugTitle(url) {
  const last = decodeURIComponent(url.split('?')[0].split('/').filter(Boolean).pop() || '');
  const t = last.replace(/-\d*p\d+$/, '').replace(/-/g, ' ').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : '';
}

function pickTitle(block, url, base, linkRe) {
  const anchors = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(block))) {
    const href = attr(m[1], 'href').split('#')[0].split('?')[0];
    if (linkRe.test(href) && absUrl(href, base) === url) anchors.push({ tag: m[1], inner: m[2] });
  }
  for (const a of anchors) {
    const t = attr(a.tag, 'title').trim();
    if (t.length >= 8) return t;
  }
  for (const a of anchors) {
    for (const img of a.inner.match(/<img\b[^>]*>/gi) || []) {
      const alt = attr(img, 'alt').trim();
      if (alt.length >= 10) return alt;
    }
  }
  for (const a of anchors) {
    const t = htmlToText(a.inner);
    if (t.length >= 8 && t.length <= 160) return t;
  }
  return slugTitle(url);
}

function pickImage(block, base) {
  for (const tag of block.match(/<img\b[^>]*>/gi) || []) {
    for (const name of ['data-src', 'data-lazy-src', 'data-original', 'data-lazy', 'src']) {
      const v = attr(tag, name).trim();
      if (!v || /^data:/i.test(v) || /loading|placeholder|spacer|blank|pixel|logo|icon|\.gif(\?|$)/i.test(v)) continue;
      const u = absUrl(v, base);
      if (u) return u;
    }
  }
  return null;
}

function scan(html, { base, linkRe }) {
  const hits = [];
  const re = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const raw = (m[1] ?? m[2] ?? '').split('#')[0].split('?')[0];
    if (!linkRe.test(raw)) continue;
    const url = absUrl(raw, base);
    if (url) hits.push({ url, index: m.index });
  }

  const order = [];
  const first = new Map();
  for (const h of hits) {
    if (!first.has(h.url)) {
      first.set(h.url, h.index);
      order.push(h.url);
    }
  }

  const items = [];
  order.forEach((url, i) => {
    const start = first.get(url);
    const end = i + 1 < order.length ? first.get(order[i + 1]) : Math.min(html.length, start + 6000);
    const block = html.slice(start, end);
    const text = htmlToText(block);
    const price = pickPrice(text);
    const title = pickTitle(block, url, base, linkRe);
    if (!title || title.length < 5 || !Number.isFinite(price)) return;
    items.push({ title, price, url, image: pickImage(block, base), inStock: pickStock(text) });
  });
  return { items, firstIndex: hits.length ? hits[0].index : -1 };
}

function parseListing(html, opts) {
  return scan(html, opts).items;
}

async function getHtml(url, signal) {
  const res = await fetch(url, {
    signal,
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'sk-SK,sk;q=0.9' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function listingShop({ id, name, base, pageUrl, linkRe, maxPages, ttlMs }) {
  const shop = {
    id,
    name,
    url: base,
    catalog: true,
    background: true,
    ttlMs,
    debug: { at: null, pages: 0, count: 0, error: null, sample: '', firstItems: [] },
    async crawl() {
      const seen = new Map();
      let pages = 0;
      let sample = '';
      let lastError = null;
      for (let p = 1; p <= maxPages; p++) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 15000);
        let html;
        try {
          html = await getHtml(pageUrl(p), ctrl.signal);
        } catch (err) {
          if (p === 1) {
            shop.debug = { ...shop.debug, at: new Date().toISOString(), error: err.message };
            throw err;
          }
          lastError = err.message;
          break;
        } finally {
          clearTimeout(timer);
        }
        pages = p;
        const { items, firstIndex } = scan(html, { base, linkRe });
        if (p === 1) sample = firstIndex >= 0 ? html.slice(Math.max(0, firstIndex - 300), firstIndex + 2700) : html.slice(0, 2000);
        let added = 0;
        for (const it of items) {
          if (!seen.has(it.url)) {
            seen.set(it.url, it);
            added++;
          }
        }
        if (!added) break; // prázdna alebo opakujúca sa strana = koniec
        if (p < maxPages) await sleep(1000);
      }
      const all = [...seen.values()];
      shop.debug = { at: new Date().toISOString(), pages, count: all.length, error: lastError, sample, firstItems: all.slice(0, 5) };
      if (!all.length) throw new Error('na stránke sa nenašli žiadne produkty');
      return all;
    },
  };
  return shop;
}

module.exports = { listingShop, parseListing };
