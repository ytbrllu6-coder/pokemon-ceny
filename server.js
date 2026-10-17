'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { searchAll, featured } = require('./search');
const { SHOPS } = require('./shops');

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
});
