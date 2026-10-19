'use strict';

/* Smarty: ceny si načíta tvoj vlastný prehliadač (záložka na smarty.sk), nie náš server.
   Uložia sa len u teba (localStorage) a pridajú sa k výsledkom vyhľadávania. */
(() => {
  const KEY = 'pokeceny.smarty';
  const SMARTY = 'https://www.smarty.sk';
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY) || 'null');
      return d && Array.isArray(d.items) ? d : null;
    } catch { return null; }
  }

  // pridá uložené ponuky zo Smarty k výsledkom hľadania
  window.mergeSmarty = (data) => {
    const store = load();
    if (!store || !data) return data;
    const tokens = norm(data.expandedQuery || data.query).split(' ').filter(Boolean);
    const found = store.items.filter((it) => {
      const t = norm(it.title);
      const words = t.split(' ');
      return tokens.every((tok) => (tok.length <= 3 ? words.some((w) => w.startsWith(tok)) : t.includes(tok)));
    }).map((it) => ({ ...it, shopId: 'smarty', shopName: 'Smarty' }));
    const results = data.results.filter((r) => r.shopId !== 'smarty').concat(found);
    results.forEach((r) => delete r.cheapest);
    results.sort((a, b) => Number(b.inStock) - Number(a.inStock) || a.price - b.price);
    const first = results.find((r) => r.inStock);
    if (first) first.cheapest = true;
    const day = new Date(store.at).toLocaleDateString('sk-SK');
    const shops = data.shops.filter((s) => s.id !== 'smarty')
      .concat([{ id: 'smarty', name: `Smarty (z tvojho prehliadača, ${day})`, ok: true, loading: false, count: found.length }]);
    return { ...data, results, shops };
  };

  // príjem dát zo záložky otvorenej na smarty.sk
  async function receive(pages) {
    const seen = new Map();
    for (const html of pages) {
      const res = await fetch('/api/parse-listing?shop=smarty', { method: 'POST', body: html });
      if (!res.ok) throw new Error('Spracovanie zlyhalo');
      for (const it of (await res.json()).items) seen.set(it.url, it);
    }
    const items = [...seen.values()];
    if (!items.length) throw new Error('V načítaných stránkach sa nenašli produkty.');
    localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), items }));
    return items.length;
  }

  function banner(text, bad) {
    let el = document.getElementById('smartyMsg');
    if (!el) {
      el = document.createElement('div');
      el.id = 'smartyMsg';
      el.setAttribute('role', 'status');
      el.style.cssText = 'position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:99;max-width:92vw;padding:12px 18px;border-radius:10px;font:600 .95rem system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.3)';
      document.body.appendChild(el);
    }
    el.style.background = bad ? '#b3261e' : '#1b5e20';
    el.style.color = '#fff';
    el.textContent = text;
  }

  window.addEventListener('message', async (e) => {
    if (e.origin !== SMARTY || !e.data || e.data.type !== 'smarty' || !Array.isArray(e.data.pages)) return;
    banner('Spracúvam ponuky zo Smarty…');
    try {
      const n = await receive(e.data.pages.filter((p) => typeof p === 'string').slice(0, 20));
      banner(`Smarty: uložených ${n} produktov. Teraz sa zobrazia vo výsledkoch.`);
      const q = new URLSearchParams(location.search).get('q');
      if (q && typeof search === 'function') search(q);
    } catch (err) {
      banner(err.message, true);
    }
  });

  if (window.opener && new URLSearchParams(location.search).get('smarty')) {
    try { window.opener.postMessage('pokeceny-ready', SMARTY); } catch { /* nič */ }
  }
})();
