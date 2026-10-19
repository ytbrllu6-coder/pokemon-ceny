'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { searchAll, featured, related, warmUp } = require('./search');
const { SHOPS } = require('./shops');
const { findCards, buildQueries } = require('./cards');
const { parseListing } = require('./listing');

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
