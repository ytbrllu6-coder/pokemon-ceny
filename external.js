'use strict';

/**
 * Ponuky, ktoré do appky nahral majiteľ (skript v jeho prehliadači), chránené tajným heslom SMARTY_TOKEN.
 * Držia sa v pamäti servera (a pre istotu v dočasnom súbore); po reštarte ich skript nahrá znova.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const FILE = path.join(os.tmpdir(), 'pokeceny-external.json');
const SOURCES = { smarty: { name: 'Smarty', base: 'https://www.smarty.sk/' } };
let store = {};
try {
  store = JSON.parse(fs.readFileSync(FILE, 'utf8'));
} catch { /* nič uložené */ }

function tokenOk(given) {
  const want = process.env.SMARTY_TOKEN;
  if (!want || typeof given !== 'string') return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(want).digest();
  return crypto.timingSafeEqual(a, b);
}

// len dôveryhodný tvar: https odkaz na daný obchod, rozumná cena a text
function clean(id, items) {
  const src = SOURCES[id];
  if (!src || !Array.isArray(items)) return [];
  const out = [];
  for (const it of items.slice(0, 5000)) {
    if (!it || typeof it.title !== 'string' || typeof it.url !== 'string') continue;
    const price = Number(it.price);
    if (!(price >= 0.5 && price <= 5000) || !it.url.startsWith(src.base) || it.title.length > 200) continue;
    out.push({
      title: it.title,
      price,
      url: it.url,
      image: typeof it.image === 'string' && it.image.startsWith('https://') ? it.image : null,
      inStock: Boolean(it.inStock),
    });
  }
  return out;
}

function set(id, items) {
  const cleaned = clean(id, items);
  if (!cleaned.length) return 0;
  store[id] = { at: Date.now(), items: cleaned };
  try { fs.writeFileSync(FILE, JSON.stringify(store)); } catch { /* disk je len bonus */ }
  return cleaned.length;
}

const get = (id) => store[id] || null;
const ids = () => Object.keys(SOURCES);
const name = (id) => SOURCES[id].name;

module.exports = { tokenOk, clean, set, get, ids, name };
