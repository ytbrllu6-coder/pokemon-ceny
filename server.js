'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { searchAll, featured, related, warmUp } = require('./search');
const { SHOPS } = require('./shops');
const { findCards, buildQueries } = require('./cards');
const { parseListing } = require('./listing');
const external = require('./external');

const LISTING_SHOPS = { smarty: { base: 'https://www.smarty.sk', linkRe: /-\d+p\d+$/ } };

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/api/search') {
    const q = (url.searchParams.get('q') || '').trim();
    if (q.length < 2 || q.length > 100) {
      return sendJson(res, 400, { error: 'Zadaj aspoň 2 znaky (max. 100).' });
    }
    const pokemonOnly = url.searchParams.get('all') !== '1';
    try {
      return sendJson(res, 200, await searchAll(q, { pokemonOnly }));
    } catch (err) {
      console.error(err);
      return sendJson(res, 500, { error: 'Vyhľadávanie zlyhalo.' });
    }
  }

  if (url.pathname === '/api/featured') {
    try {
      return sendJson(res, 200, await featured());
    } catch (err) {
      console.error(err);
      return sendJson(res, 200, []);
    }
  }

  // Používateľský skript (Tampermonkey/Userscripts): sám načíta Smarty v prehliadači používateľa
  if (url.pathname === '/pokeceny-smarty.user.js') {
    const origin = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
    const js = `// ==UserScript==
// @name         PokéCeny: Smarty
// @namespace    ${origin}
// @version      1.3
// @description  Keď otvoríš PokéCeny, tvoj prehliadač si sám načíta ceny zo Smarty (najviac raz za 6 hodín).
// @match        ${origin}/*
// @connect      www.smarty.sk
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// ==/UserScript==
(async () => {
  const KEY = 'pokeceny.smarty';
  const BASE = 'https://www.smarty.sk/Produkty/pokemon-karty';
  const gm = typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest : (o) => GM.xmlHttpRequest(o);
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:99999;max-width:90vw;padding:8px 14px;border-radius:8px;font:600 13px system-ui,sans-serif;color:#fff;background:#37474f;display:none';
  document.addEventListener('DOMContentLoaded', () => document.body.appendChild(box));
  const say = (t, bad) => { box.textContent = 'Smarty: ' + t; box.style.background = bad ? '#b3261e' : '#37474f'; box.style.display = 'block'; if (!box.parentNode && document.body) document.body.appendChild(box); console.log('[Smarty]', t); };
  const force = new URLSearchParams(location.search).get('smarty') === 'force';
  try {
    const old = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!force && old && Date.now() - old.at < 6 * 3600 * 1000) { console.log('[Smarty] ceny su cerstve (' + old.items.length + ')'); return; }
  } catch (e) {}
  const get = (u) => new Promise((ok, no) => gm({ method: 'GET', url: u, timeout: 20000,
    onload: (r) => (r.status === 200 ? ok(r.responseText) : no(new Error('HTTP ' + r.status))),
    onerror: () => no(new Error('pripojenie zlyhalo alebo je zablokovane')), ontimeout: () => no(new Error('vyprsal cas')) }));
  say('načítavam…');
  const seenLinks = new Set();
  const items = new Map();
  for (let p = 1; p <= 15; p++) {
    let html;
    try { html = await get(p > 1 ? BASE + '?pg=' + p : BASE); } catch (e) { if (p === 1) { say('nepodarilo sa otvoriť Smarty (' + e.message + ')', true); return; } break; }
    const fresh = [...html.matchAll(/href="([^"#?]*-\\d+p\\d+)"/g)].map((m) => m[1]).filter((l) => !seenLinks.has(l));
    if (!fresh.length) { if (p === 1) say('na stránke sa nenašli odkazy na produkty', true); break; }
    fresh.forEach((l) => seenLinks.add(l));
    const res = await fetch('/api/parse-listing?shop=smarty', { method: 'POST', body: html });
    if (res.ok) for (const it of (await res.json()).items) items.set(it.url, it);
    say('načítavam… strana ' + p + ', produktov ' + items.size);
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!items.size) { say('nenašli sa žiadne produkty s cenou', true); return; }
  localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), items: [...items.values()] }));
  let msg = 'hotovo, uložených ' + items.size + ' produktov u teba';
  try {
    let tok = localStorage.getItem('pokeceny.token');
    if (!tok) { tok = prompt('PokéCeny: zadaj heslo majiteľa (SMARTY_TOKEN z Renderu), aby sa Smarty zobrazilo aj ostatným. Zruš = len u mňa.'); if (tok) localStorage.setItem('pokeceny.token', tok.trim()); }
    if (tok) {
      const up = await fetch('/api/external-upload', { method: 'POST', headers: { 'X-Token': tok.trim(), 'Content-Type': 'application/json' }, body: JSON.stringify({ shop: 'smarty', items: [...items.values()] }) });
      if (up.ok) msg += ', nahrané aj na server pre všetkých';
      else { if (up.status === 401) localStorage.removeItem('pokeceny.token'); say('hotovo, ale nahratie na server zlyhalo (' + up.status + ')', true); return; }
    }
  } catch (e) {}
  say(msg);
  const q = new URLSearchParams(location.search).get('q');
  if (q && typeof search === 'function') search(q);
})();
`;
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
    return res.end(js);
  }

  // Nahratie ponúk majiteľom (chránené heslom SMARTY_TOKEN)
  if (url.pathname === '/api/external-upload' && req.method === 'POST') {
    if (!process.env.SMARTY_TOKEN) return sendJson(res, 503, { error: 'Na serveri nie je nastavené SMARTY_TOKEN.' });
    if (!external.tokenOk(req.headers['x-token'])) return sendJson(res, 401, { error: 'Nesprávne heslo.' });
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 8_000_000) return sendJson(res, 413, { error: 'Príliš veľké.' });
    }
    let data;
    try { data = JSON.parse(body); } catch { return sendJson(res, 400, { error: 'Neplatný JSON.' }); }
    const n = external.set(String(data.shop), data.items);
    return n ? sendJson(res, 200, { saved: n }) : sendJson(res, 400, { error: 'Nič platné na uloženie.' });
  }

  // Spracovanie HTML výpisu, ktorý poslal prehliadač používateľa (nič sa neukladá)
  if (url.pathname === '/api/parse-listing' && req.method === 'POST') {
    const cfg = LISTING_SHOPS[url.searchParams.get('shop')];
    if (!cfg) return sendJson(res, 400, { error: 'Neznámy obchod.' });
    let body = '';
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 4_000_000) return sendJson(res, 413, { error: 'Stránka je príliš veľká.' });
      body += chunk;
    }
    const items = parseListing(body, cfg)
      .filter((it) => it.url.startsWith(cfg.base + '/'))
      .map((it) => ({ ...it, image: it.image && it.image.startsWith('https://') ? it.image : null }));
    return sendJson(res, 200, { items });
  }

  // Cena jednotlivej karty (Cardmarket cez Pokémon TCG API)
  if (url.pathname === '/api/card') {
    const input = {
      name: (url.searchParams.get('name') || '').trim().slice(0, 60),
      number: (url.searchParams.get('number') || '').trim().slice(0, 6),
      total: (url.searchParams.get('total') || '').trim().slice(0, 4),
    };
    if (!buildQueries(input).length) {
      return sendJson(res, 400, { error: 'Zadaj názov karty alebo celé číslo (napr. 123/191).' });
    }
    try {
      return sendJson(res, 200, await findCards(input));
    } catch (err) {
      console.error(err);
      return sendJson(res, 502, { error: 'Ceny z Cardmarketu sa teraz nepodarilo načítať, skús to o chvíľu.' });
    }
  }

  if (url.pathname === '/api/related') {
    const title = (url.searchParams.get('title') || '').trim();
    if (title.length < 3 || title.length > 200) return sendJson(res, 400, { error: 'Chýba názov produktu.' });
    try {
      return sendJson(res, 200, await related(title));
    } catch (err) {
      console.error(err);
      return sendJson(res, 500, { error: 'Vyhľadávanie zlyhalo.' });
    }
  }

  // Diagnostika obchodov sťahovaných z HTML: čo sa našlo a vzorka zdrojového HTML
  if (url.pathname === '/api/debug') {
    const shop = SHOPS.find((s) => s.id === url.searchParams.get('shop'));
    if (!shop || !shop.debug) return sendJson(res, 404, { error: 'Neznámy obchod.' });
    return sendJson(res, 200, { id: shop.id, ...shop.debug });
  }

  if (url.pathname === '/api/shops') {
    return sendJson(res, 200, SHOPS.map(({ id, name, url }) => ({ id, name, url })));
  }

  // statické súbory
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const file = path.resolve(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end('Zakázané');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Nenájdené');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Pokémon ceny beží na http://localhost:${PORT}`);
  setTimeout(warmUp, 1000); // stiahne katalógy obchodov na pozadí
});
