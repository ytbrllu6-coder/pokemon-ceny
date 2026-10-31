'use strict';

/* Sety: prehľad všetkých setov, po kliknutí karty (ceny z Cardmarketu) a produkty z obchodov. */
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const eur = new Intl.NumberFormat('sk-SK', { style: 'currency', currency: 'EUR' });
  const fmtDate = (d) => {
    const t = Date.parse(String(d || '').replace(/\//g, '-'));
    return Number.isFinite(t) ? new Date(t).toLocaleDateString('sk-SK') : '';
  };
  const num = (n) => parseInt(String(n).replace(/\D+/g, ''), 10) || 0;

  const state = { sets: [], loaded: false, cur: null, tab: 'cards', cards: null, products: null };

  async function api(path) {
    const res = await fetch(path);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || 'Chyba servera');
    return d;
  }

  // ---------- zoznam setov ----------
  async function loadSets() {
    $('list').innerHTML = '<div class="skel"></div><div class="skel"></div>';
    try {
      const d = await api('/api/sets');
      state.sets = d.sets;
      state.loaded = true;
      renderList();
    } catch (err) {
      $('list').innerHTML = `<div class="empty"><h2>Sety sa nepodarilo načítať</h2><p>${esc(err.message)}</p></div>`;
    }
  }

  function renderList() {
    const q = $('find').value.trim().toLowerCase();
    const sets = state.sets.filter((s) => !q || `${s.name} ${s.series} ${s.code || ''}`.toLowerCase().includes(q));
    if (!sets.length) {
      $('list').innerHTML = '<p class="empty">Žiadny set sa nenašiel.</p>';
      return;
    }
    const groups = new Map();
    for (const s of sets) {
      if (!groups.has(s.series)) groups.set(s.series, []);
      groups.get(s.series).push(s);
    }
    $('list').innerHTML = [...groups].map(([series, list]) => `
      <h2 class="series">${esc(series)}</h2>
      <div class="sets">${list.map((s) => `
        <a class="set" href="#${encodeURIComponent(s.id)}">
          <span class="logo">${s.logo ? `<img src="${esc(s.logo)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}</span>
          <b>${esc(s.name)}</b>
          <small>${s.total ? esc(s.total) + ' kariet' : ''}${s.total && s.date ? ' · ' : ''}${esc(fmtDate(s.date))}</small>
        </a>`).join('')}</div>`).join('');
  }

  // ---------- detail setu ----------
  async function openSet(id) {
    $('list').hidden = true;
    document.querySelector('.hero').hidden = true;
    $('detail').hidden = false;
    state.cur = null;
    state.cards = null;
    state.products = null;
    state.tab = 'cards';
    $('detail').innerHTML = '<a class="back" href="#">← Všetky sety</a><div class="skel"></div>';
    window.scrollTo(0, 0);
    try {
      const d = await api('/api/set-cards?id=' + encodeURIComponent(id));
      state.cur = d.set;
      state.cards = d;
      renderDetail();
    } catch (err) {
      $('detail').innerHTML = `<a class="back" href="#">← Všetky sety</a><div class="empty"><h2>Set sa nepodarilo načítať</h2><p>${esc(err.message)}</p></div>`;
    }
  }

  function closeSet() {
    $('detail').hidden = true;
    $('list').hidden = false;
    document.querySelector('.hero').hidden = false;
    if (!state.loaded) loadSets();
  }

  function renderDetail() {
    const s = state.cur;
    $('detail').innerHTML = `
      <a class="back" href="#">← Všetky sety</a>
      <div class="sethead">
        ${s.logo ? `<img src="${esc(s.logo)}" alt="" referrerpolicy="no-referrer">` : ''}
        <div><h2>${esc(s.name)}</h2>
        <p>${esc(s.series)}${s.total ? ' · ' + esc(s.total) + ' kariet' : ''}${s.date ? ' · vydaný ' + esc(fmtDate(s.date)) : ''}</p></div>
      </div>
      <div class="tabs" role="tablist">
        <button role="tab" id="tabCards" aria-selected="${state.tab === 'cards'}">Karty (${state.cards.cards.length})</button>
        <button role="tab" id="tabProd" aria-selected="${state.tab === 'prod'}">Produkty</button>
      </div>
      <div id="pane"></div>`;
    $('tabCards').onclick = () => { state.tab = 'cards'; renderDetail(); };
    $('tabProd').onclick = () => { state.tab = 'prod'; renderDetail(); };
    if (state.tab === 'cards') renderCards();
    else renderProducts();
  }

  // ---------- karty ----------
  function renderCards() {
    const { cards, source } = state.cards;
    const dates = cards.map((c) => c.updated).filter(Boolean).sort();
    $('pane').innerHTML = `
      <div class="tools">
        <input id="cf" type="search" placeholder="Hľadať kartu v sete" autocomplete="off">
        <select id="cs" aria-label="Zoradiť">
          <option value="num">Podľa čísla</option>
          <option value="price">Najdrahšie</option>
          <option value="name">Podľa názvu</option>
        </select>
      </div>
      <p class="note">${source === 'tcgdex'
        ? 'Ceny teraz nie sú dostupné (záložný zdroj). Kliknutím na kartu zistíš cenu v sekcii Karty.'
        : `Ceny: 30-dňový priemer z Cardmarketu${dates.length ? ', stav k ' + esc(fmtDate(dates[dates.length - 1])) : ''}. Pri nových setoch cena chýba a pri niektorých môže byť zastaraná.`}</p>
      <div class="cards" id="grid"></div>`;
    const draw = () => {
      const f = $('cf').value.trim().toLowerCase();
      const how = $('cs').value;
      let list = cards.filter((c) => !f || `${c.name} ${c.number} ${c.rarity || ''}`.toLowerCase().includes(f));
      list = [...list].sort((a, b) => how === 'price' ? (b.avg30 || -1) - (a.avg30 || -1)
        : how === 'name' ? a.name.localeCompare(b.name) || num(a.number) - num(b.number)
        : num(a.number) - num(b.number) || String(a.number).localeCompare(String(b.number)));
      $('grid').innerHTML = list.length ? list.map((c) => {
        const link = `/karty.html?name=${encodeURIComponent(c.name)}&number=${encodeURIComponent(num(c.number) || c.number)}&set=id.${encodeURIComponent(String(state.cur.id).replace(/^tcgdex:/, ''))}`;
        return `<div class="card"><a href="${link}">
          ${c.image ? `<img src="${esc(c.image)}" alt="${esc(c.name)}" loading="lazy" referrerpolicy="no-referrer">` : '<div class="ph"></div>'}
          <b>${esc(c.name)}</b>
          <small>#${esc(c.number)}${c.rarity ? ' · ' + esc(c.rarity) : ''}</small>
          <span class="pr">${c.avg30 ? eur.format(c.avg30) : '<small>bez ceny</small>'}</span>
        </a><button type="button" class="add" data-card="${esc(c.id)}">${window.pfLabel ? window.pfLabel('card:' + c.id) : '+ Portfólio'}</button></div>`;
      }).join('') : '<p class="empty">Žiadna karta sa nenašla.</p>';
    };
    $('cf').addEventListener('input', draw);
    $('cs').addEventListener('change', draw);
    draw();
  }

  // ---------- produkty ----------
  async function renderProducts() {
    const q = state.cur.name.split(':')[0].trim();
    $('pane').innerHTML = `<p class="note">Produkty z obchodov, ktorých názov obsahuje „${esc(q)}“.</p><div id="prods"><div class="skel"></div></div>`;
    try {
      if (!state.products) state.products = await api('/api/search?q=' + encodeURIComponent(q));
      const d = state.products;
      if (state.tab !== 'prod' || !$('prods')) return;
      $('prods').innerHTML = d.results.length ? d.results.map((r) => `
        <div class="prod ${r.inStock ? '' : 'out'}">
          ${r.image ? `<img src="${esc(r.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<div class="ph"></div>'}
          <div><h4><a class="title" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.title)}</a></h4>
          <small>${esc(r.shopName)} · ${r.inStock ? 'Skladom' : 'Nie je skladom'}</small></div>
          <div class="price">${eur.format(r.price)}<button type="button" class="add" data-prod="${esc(r.url)}">${window.pfLabel ? window.pfLabel(r.url) : '+ Portfólio'}</button></div>
        </div>`).join('') : '<p class="empty">V obchodoch sme k tomuto setu nenašli žiadne produkty.</p>';
    } catch (err) {
      if ($('prods')) $('prods').innerHTML = `<p class="empty">${esc(err.message)}</p>`;
    }
  }

  // ---------- smerovanie ----------
  function route() {
    const id = decodeURIComponent(location.hash.replace(/^#/, ''));
    if (id) openSet(id);
    else closeSet();
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.add');
    if (!b || !window.Portfolio) return;
    if (b.dataset.card != null) {
      const c = state.cards.cards.find((x) => x.id === b.dataset.card);
      if (!c) return;
      window.Portfolio.add({ key: 'card:' + c.id, kind: 'card', name: c.name, sub: `${state.cur.name} #${c.number}`, image: c.image, url: c.cmUrl || null, price: c.avg30 || null, ref: { name: c.name, number: num(c.number) || c.number } });
      window.Portfolio.mark(b, 'card:' + c.id);
    } else if (b.dataset.prod != null && state.products) {
      const r = state.products.results.find((x) => x.url === b.dataset.prod);
      if (r) {
        window.Portfolio.add({ key: r.url, kind: 'product', name: r.title, sub: r.shopName, image: r.image || null, url: r.url, price: r.price, ref: { q: r.title } });
        window.Portfolio.mark(b, r.url);
      }
    }
  });
  $('find').addEventListener('input', renderList);
  window.addEventListener('hashchange', route);
  if (location.hash.length > 1) route();
  else loadSets();
})();
