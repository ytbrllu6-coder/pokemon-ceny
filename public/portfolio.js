'use strict';

/* Portfólio: karty a zapečatené produkty uložené v prehliadači (localStorage). Spoločná knižnica pre všetky stránky. */
(() => {
  const KEY = 'pokeceny.portfolio';

  const load = () => {
    try {
      const d = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(d) ? d : [];
    } catch { return []; }
  };
  const save = (items) => { try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* bez ukladania */ } };

  function toast(text) {
    let el = document.getElementById('pfToast');
    if (!el) {
      el = document.createElement('a');
      el.id = 'pfToast';
      el.href = '/portfolio.html';
      el.setAttribute('role', 'status');
      el.style.cssText = 'position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:99;padding:12px 18px;border-radius:10px;background:#1b5e20;color:#fff;font:600 .95rem system-ui,sans-serif;text-decoration:none;box-shadow:0 8px 30px rgba(0,0,0,.3);max-width:92vw';
      document.body.appendChild(el);
    }
    el.textContent = text + ' Otvoriť portfólio';
    el.style.display = 'block';
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { el.style.display = 'none'; }, 3500);
  }

  // item: { key, kind: 'card'|'product', name, sub, image, url, price, ref }
  function add(item) {
    const items = load();
    const hit = items.find((i) => i.key === item.key);
    if (hit) {
      hit.qty = (hit.qty || 1) + 1;
      hit.price = item.price ?? hit.price;
    } else {
      items.push({ qty: 1, buy: null, at: Date.now(), ...item });
    }
    save(items);
    toast(hit ? 'Počet zvýšený.' : 'Pridané do portfólia.');
  }

  const qtyOf = (key) => (load().find((i) => i.key === key) || {}).qty || 0;
  // popis tlačidla: s fajkou, ak je položka už v portfóliu
  window.pfLabel = (key) => { const q = qtyOf(key); return q ? `✓ V portfóliu${q > 1 ? ' ×' + q : ''}` : '+ Portfólio'; };
  const mark = (btn, key) => { if (btn) { btn.textContent = window.pfLabel(key); btn.classList.add('added'); } };

  window.Portfolio = { load, save, add, mark };

  // tlačidlá „+ Portfólio“ pri produktoch na hlavnej stránke
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-add]');
    if (!b || typeof state === 'undefined' || !state.data) return;
    const r = state.data.results.find((x) => x.url === b.dataset.add);
    if (!r) return;
    add({ key: r.url, kind: 'product', name: r.title, sub: r.shopName, image: r.image || null, url: r.url, price: r.price, ref: { q: r.title } });
    mark(b, r.url);
  });
})();
