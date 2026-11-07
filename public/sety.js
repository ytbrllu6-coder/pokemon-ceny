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

  const MASTER = new URLSearchParams(location.search).has('master');
  if (MASTER) {
    document.title = 'Master set guide – PokéCeny';
    document.querySelector('.hero h1').textContent = 'Master set guide';
    document.querySelector('.hero p').textContent = 'Vyber set a uvidíš zoznam všetkých jeho kariet a virtuálny binder, v ktorom si označuješ, čo už máš.';
    const a = document.getElementById('navSety'), b = document.getElementById('navMaster');
    if (a) a.removeAttribute('aria-current');
    if (b) b.setAttribute('aria-current', 'page');
  }

  const state = { sets: [], loaded: false, cur: null, tab: 'cards', cards: null, products: null, m: null };

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
        <a class="set" href="#${encodeURIComponent(s.id)}${MASTER ? '/master' : ''}">
          <span class="logo">${s.logo ? `<img src="${esc(s.logo)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}</span>
          <b>${esc(s.name)}</b>
          <small>${s.total ? esc(s.total) + ' kariet' : ''}${s.total && s.date ? ' · ' : ''}${esc(fmtDate(s.date))}</small>
        </a>`).join('')}</div>`).join('');
  }

  // ---------- detail setu ----------
  async function openSet(id, tab) {
    $('list').hidden = true;
    document.querySelector('.hero').hidden = true;
    $('detail').hidden = false;
    state.cur = null;
    state.cards = null;
    state.products = null;
    state.m = null;
    state.tab = tab === 'master' ? 'master' : 'cards';
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
        <button role="tab" id="tabMaster" aria-selected="${state.tab === 'master'}">Master set</button>
      </div>
      <div id="pane"></div>`;
    const go = (tab) => {
      state.tab = tab;
      // odkaz na záložku sa dá zdieľať (#id/master); replaceState nespúšťa hashchange, takže set sa nenačíta znova
      try { history.replaceState(null, '', '#' + encodeURIComponent(state.cur.id) + (tab === 'master' ? '/master' : MASTER ? '/cards' : '')); } catch { /* bez zmeny adresy */ }
      renderDetail();
    };
    $('tabCards').onclick = () => go('cards');
    $('tabProd').onclick = () => go('prod');
    $('tabMaster').onclick = () => go('master');
    if (state.tab === 'cards') renderCards();
    else if (state.tab === 'master') renderMaster();
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
        : source === 'tcgdex+ceny' ? `Ceny: 30-dňový priemer z Cardmarketu (TCGdex)${dates.length ? ', stav k ' + esc(fmtDate(dates[dates.length - 1])) : ''}. Ak niektorým kartám cena chýba, otvor set znova, doplnia sa.`
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

  // ---------- master set: zoznam celého setu + virtuálny binder ----------
  // Čo kartu máš a nastavenia binderu sa ukladajú v prehliadači (localStorage).
  const MKEY = 'pokeceny.master';
  const SIZES = { '3x3': { cols: 3, rows: 3 }, '4x3': { cols: 4, rows: 3 }, '4x4': { cols: 4, rows: 4 } };
  const mload = () => {
    try {
      const d = JSON.parse(localStorage.getItem(MKEY) || '{}');
      return d && typeof d === 'object' ? d : {};
    } catch { return {}; }
  };
  const msave = (d) => { try { localStorage.setItem(MKEY, JSON.stringify(d)); } catch { /* bez ukladania */ } };
  const isWide = () => window.matchMedia('(min-width: 760px)').matches;

  // poradie kariet: najprv čisto číselné (1, 2, 3 …), potom s predponou (TG01, GG01 …)
  const splitNum = (n) => {
    const m = String(n).match(/^([A-Za-z]*)(\d+)/);
    return m ? [m[1], parseInt(m[2], 10)] : [String(n), 0];
  };
  const cmpNum = (a, b) => {
    const [pa, na] = splitNum(a.number);
    const [pb, nb] = splitNum(b.number);
    if (pa !== pb) return pa === '' ? -1 : pb === '' ? 1 : pa.localeCompare(pb);
    return na - nb || String(a.number).localeCompare(String(b.number));
  };

  // Reverse holo: ak má karta cenu reverse holo, určite existuje; inak odhad podľa rarity (Common, Uncommon, Rare)
  const RH_RARITIES = new Set(['Common', 'Uncommon', 'Rare']);
  const rhEligible = (c) => c.reverse > 0 || RH_RARITIES.has(c.rarity);
  const rhPossible = () => {
    const y = parseInt(String(state.cur.date || '').slice(0, 4), 10);
    return state.cards.cards.some((c) => c.reverse > 0) || (y >= 2002 && state.cards.cards.some((c) => RH_RARITIES.has(c.rarity)));
  };

  function mInit() {
    const store = mload();
    const rec = (store.sets || {})[state.cur.id] || {};
    state.m = {
      own: new Set(Array.isArray(rec.own) ? rec.own : []),
      hasRh: rhPossible(),
      rh: store.rh !== false,          // Reverse holo (predvolene zapnuté)
      dupe: store.dupe !== false,      // Duplicate EX: karta bez reverse holo dostane druhú kópiu, inak nasleduje ďalšia karta
      prices: store.prices !== false,
      size: SIZES[store.size] ? store.size : (isWide() ? '4x3' : '3x3'),
      view: store.view === 'list' ? 'list' : 'binder',
      page: 0,
      filter: 'all',
      q: '',
    };
  }

  function mPersist() {
    const m = state.m;
    const store = mload();
    store.sets = store.sets || {};
    store.sets[state.cur.id] = { own: [...m.own] };
    Object.assign(store, { view: m.view, size: m.size, rh: m.rh, dupe: m.dupe, prices: m.prices });
    msave(store);
  }

  const geo = () => SIZES[state.m.size];
  const perPage = () => geo().cols * geo().rows;
  const rhOn = () => state.m.hasRh && state.m.rh;

  // Miesta v binderi: vedľa každej karty je jej reverse holo. Karta bez reverse holo (napr. ex) má podľa voľby
  // Duplicate EX buď druhú kópiu (kľúč id:2), alebo hneď za ňou nasleduje ďalšia karta.
  function masterSlots() {
    const out = [];
    for (const c of [...state.cards.cards].sort(cmpNum)) {
      out.push({ key: c.id, c, rh: false, price: c.avg30 || null });
      if (!rhOn()) continue;
      if (rhEligible(c)) out.push({ key: c.id + ':rh', c, rh: true, price: c.reverse || null });
      else if (state.m.dupe) out.push({ key: c.id + ':2', c, rh: false, copy: true, price: c.avg30 || null });
    }
    return out;
  }

  function mStats(items) {
    const own = state.m.own;
    const st = { total: items.length, have: 0, haveVal: 0, missVal: 0, noPrice: 0, rar: new Map() };
    for (const it of items) {
      const has = own.has(it.key);
      if (has) { st.have++; st.haveVal += it.price || 0; } else st.missVal += it.price || 0;
      if (!it.price) st.noPrice++;
      const r = it.rh ? 'Reverse holo' : (it.c.rarity || 'Neznáma rarita');
      const g = st.rar.get(r) || { n: 0, have: 0 };
      g.n++;
      if (has) g.have++;
      st.rar.set(r, g);
    }
    return st;
  }

  function drawSummary(items) {
    const st = mStats(items);
    const pct = st.total ? Math.floor((st.have / st.total) * 100) : 0;
    const total = state.cur.total;
    const base = items.filter((i) => !i.rh && !i.copy);
    const nRh = items.filter((i) => i.rh).length;
    const nCopy = items.filter((i) => i.copy).length;
    const extra = total ? base.filter((i) => { const [p, n] = splitNum(i.c.number); return p !== '' || n > total; }).length : 0;
    const dates = state.cards.cards.map((c) => c.updated).filter(Boolean).sort();
    $('msum').innerHTML = `
      <div class="mprog" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><div class="mfill" style="width:${pct}%"></div></div>
      <div class="mnums"><b>${st.have} / ${st.total}</b> <span>${pct} % hotovo</span>
        <span>Hodnota tvojich kariet: ${eur.format(st.haveVal)}</span>
        <span>Dokúpiť zhruba: ${eur.format(st.missVal)}</span></div>
      <p class="note">${total ? `Set má ${esc(total)} očíslovaných kariet. ` : ''}Master set: ${base.length} kariet${extra ? ` (z toho ${extra} secret rare a špeciálnych nad číslovanie)` : ''}${nRh ? ` + ${nRh} reverse holo` : ''}${nCopy ? ` + ${nCopy} druhých kópií kariet bez reverse holo` : ''}. Ceny sú 30-dňový priemer z Cardmarketu${dates.length ? ', stav k ' + esc(fmtDate(dates[dates.length - 1])) : ''}${st.noPrice ? `; u ${st.noPrice} kariet cena chýba, do súčtov sa nepočíta` : ''}.</p>
      <div class="chips">${[...st.rar].map(([r, g]) => `<span class="chip${g.have === g.n ? ' done' : ''}">${esc(r)} ${g.have}/${g.n}</span>`).join('')}</div>`;
  }

  const slotImg = (c) => (c.image ? `<img src="${esc(c.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span class="ph"></span>');
  const slotPic = (c) => (c.image ? `<img src="${esc(c.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="ph">${esc(c.name)}</span>`);
  const matchesQ = (it, q) => `${it.c.name} ${it.c.number} ${it.c.rarity || ''}`.toLowerCase().includes(q);

  // Jedno miesto v binderi: celá karta je tlačidlo „mám / nemám“, lupa v rohu otvorí náhľad
  function slotHtml(it, m, q) {
    const own = m.own.has(it.key);
    const tag = it.rh ? ' (reverse holo)' : it.copy ? ' (druhá kópia)' : '';
    const label = `${it.c.name} #${it.c.number}${tag}`;
    return `<div class="slot${own ? ' own' : ''}${it.rh ? ' rh' : ''}${q && matchesQ(it, q) ? ' match' : ''}" data-k="${esc(it.key)}">
      ${slotPic(it.c)}
      <button type="button" class="hit" aria-pressed="${own}" aria-label="${esc(label)}" title="${esc(label)}"></button>
      <button type="button" class="zoom" data-zoom="${esc(it.key)}" aria-label="Náhľad: ${esc(label)}" title="Náhľad a cena">⌕</button>
      <span class="num">#${esc(it.c.number)}${it.rh ? ' RH' : it.copy ? ' ×2' : ''}</span>
      ${m.prices && it.price ? `<span class="pr">${eur.format(it.price)}</span>` : ''}
    </div>`;
  }

  // Binder ako kniha: prvá strana je sama vpravo, potom idú dvojstrany (2–3, 4–5 …); na mobile jedna strana
  function drawBinder(slots) {
    const m = state.m;
    const per = perPage();
    const { cols } = geo();
    const wide = isWide();
    const pages = Math.max(1, Math.ceil(slots.length / per));
    m.page = Math.min(Math.max(0, m.page), pages - 1);
    const spread = Math.floor((m.page + 1) / 2);
    const lastSpread = Math.floor(pages / 2);
    const shown = wide ? [2 * spread - 1, 2 * spread] : [m.page];
    const q = m.q.trim().toLowerCase();
    const pageHtml = (p) => {
      if (p < 0 || p >= pages) return '<div class="bpage blank"></div>';
      const slice = slots.slice(p * per, (p + 1) * per);
      const html = slice.map((it) => slotHtml(it, m, q)).join('') + '<span class="slot void"></span>'.repeat(per - slice.length);
      return `<div class="bpage c${cols}">${html}<span class="pn">Strana ${p + 1} z ${pages}</span></div>`;
    };
    const opts = [];
    if (wide) {
      for (let s = 0; s <= lastSpread; s++) {
        const lo = s === 0 ? 1 : 2 * s;
        const hi = Math.min(pages, 2 * s + 1);
        opts.push(`<option value="${s === 0 ? 0 : 2 * s - 1}"${s === spread ? ' selected' : ''}>${lo === hi ? 'Strana ' + lo : 'Strany ' + lo + '–' + hi}</option>`);
      }
    } else {
      for (let p = 0; p < pages; p++) opts.push(`<option value="${p}"${p === m.page ? ' selected' : ''}>Strana ${p + 1}</option>`);
    }
    const atStart = wide ? spread <= 0 : m.page <= 0;
    const atEnd = wide ? spread >= lastSpread : m.page >= pages - 1;
    const found = q ? slots.filter((it) => matchesQ(it, q)).length : 0;
    $('mview').innerHTML = `
      <div class="bwide">
        <button type="button" class="sidearrow l" data-turn="-1" aria-label="Predchádzajúca strana"${atStart ? ' disabled' : ''}>‹</button>
        <div class="binder${wide ? ' spread' : ''}">${shown.map(pageHtml).join('')}</div>
        <button type="button" class="sidearrow r" data-turn="1" aria-label="Ďalšia strana"${atEnd ? ' disabled' : ''}>›</button>
      </div>
      <div class="bnav">
        <button type="button" data-turn="-1" aria-label="Predchádzajúca strana"${atStart ? ' disabled' : ''}>←</button>
        <select id="bjump" aria-label="Prejsť na stranu">${opts.join('')}</select>
        <button type="button" data-turn="1" aria-label="Ďalšia strana"${atEnd ? ' disabled' : ''}>→</button>
      </div>
      <p class="note" style="text-align:center">${q ? (found ? `Nájdených kariet: ${found}, sú zvýraznené žltým rámikom.` : 'Žiadna karta nesedí na hľadanie.')
        : 'Kliknutím na kartu ju označíš, že ju máš (zelený rámik s fajkou). Lupa v rohu otvorí náhľad s cenou. Strany listuješ aj šípkami na klávesnici.'}</p>`;
  }

  function turnPage(dir) {
    const m = state.m;
    const pages = Math.max(1, Math.ceil(masterSlots().length / perPage()));
    if (isWide()) {
      const s = Math.min(Math.max(0, Math.floor((m.page + 1) / 2) + dir), Math.floor(pages / 2));
      m.page = s === 0 ? 0 : 2 * s - 1;
    } else {
      m.page = Math.min(Math.max(0, m.page + dir), pages - 1);
    }
    drawBinder(masterSlots());
  }

  // hľadanie v binderi: skočí na stranu s prvou nájdenou kartou a zvýrazní všetky nájdené
  function binderSearch() {
    const m = state.m;
    const q = m.q.trim().toLowerCase();
    const slots = masterSlots();
    if (q) {
      const i = slots.findIndex((it) => matchesQ(it, q));
      if (i >= 0) m.page = Math.floor(i / perPage());
    }
    drawBinder(slots);
  }

  // ---------- zoznam ----------
  function drawList() {
    const m = state.m;
    $('mview').innerHTML = `
      <div class="tools">
        <select id="mf" aria-label="Filter">
          <option value="all">Všetky</option>
          <option value="own">Mám</option>
          <option value="missing">Chýbajú</option>
        </select>
      </div>
      <div id="mrows" class="mrows"></div>`;
    $('mf').value = m.filter;
    $('mf').onchange = (e) => { m.filter = e.target.value; drawRows(); };
    drawRows();
  }

  function drawRows() {
    const m = state.m;
    const f = m.q.trim().toLowerCase();
    const list = masterSlots().filter((it) => {
      const own = m.own.has(it.key);
      if (m.filter === 'own' && !own) return false;
      if (m.filter === 'missing' && own) return false;
      return !f || matchesQ(it, f);
    });
    $('mrows').innerHTML = list.map((it) => {
      const own = m.own.has(it.key);
      return `<label class="mrow${own ? ' own' : ''}" data-k="${esc(it.key)}">
        <input type="checkbox"${own ? ' checked' : ''}>
        ${slotImg(it.c)}
        <span><b>${esc(it.c.name)}${it.rh ? ' (reverse holo)' : it.copy ? ' (2. kópia)' : ''}</b><small>#${esc(it.c.number)}${it.c.rarity ? ' · ' + esc(it.c.rarity) : ''}</small></span>
        <span class="mp">${it.price ? eur.format(it.price) : '<small>bez ceny</small>'}</span></label>`;
    }).join('') || '<p class="empty">Žiadna karta nesedí na filter.</p>';
  }

  function syncCtl() {
    const m = state.m;
    const on = (id, v) => { const el = $(id); if (el) el.setAttribute('aria-pressed', String(v)); };
    on('mvB', m.view === 'binder');
    on('mvL', m.view === 'list');
    document.querySelectorAll('[data-size]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.size === m.size)));
    $('gsize').hidden = m.view !== 'binder';
    on('trh', m.rh);
    on('tdup', m.rh && m.dupe);
    on('tpr', m.prices);
    if ($('tdup')) $('tdup').disabled = !m.rh;
  }

  function drawMasterView() {
    const slots = masterSlots();
    drawSummary(slots);
    syncCtl();
    if (!slots.length) $('mview').innerHTML = '<p class="empty">Tento set nemá žiadne karty na zobrazenie.</p>';
    else if (state.m.view === 'binder') drawBinder(slots);
    else drawList();
  }

  function toggleOwned(key) {
    const m = state.m;
    if (m.own.has(key)) m.own.delete(key);
    else m.own.add(key);
    mPersist();
    const has = m.own.has(key);
    drawSummary(masterSlots());
    if (m.view === 'list' && m.filter !== 'all') { drawRows(); return; }
    for (const el of $('mview').querySelectorAll('[data-k]')) {
      if (el.dataset.k !== key) continue;
      el.classList.toggle('own', has);
      const hit = el.querySelector('.hit');
      if (hit) hit.setAttribute('aria-pressed', String(has));
      const box = el.querySelector('input');
      if (box) box.checked = has;
    }
  }

  // ---------- náhľad karty s cenou ----------
  let previewFrom = null;
  const bigImg = (u) => (/images\.pokemontcg\.io\/.*\.png$/.test(u) ? u.replace(/\.png$/, '_hires.png') : u.replace(/\/low\.webp$/, '/high.webp'));

  function closePreview() {
    const o = $('mmodal');
    if (!o) return;
    o.remove();
    if (previewFrom && document.contains(previewFrom)) previewFrom.focus();
    previewFrom = null;
  }

  function openPreview(key) {
    const it = masterSlots().find((i) => i.key === key);
    if (!it) return;
    closePreview();
    previewFrom = document.activeElement;
    const c = it.c;
    const m = state.m;
    const tag = it.rh ? 'Reverse holo' : it.copy ? 'Druhá kópia' : 'Základná karta';
    const o = document.createElement('div');
    o.id = 'mmodal';
    o.className = 'mmodal';
    o.innerHTML = `<div class="mm-box" role="dialog" aria-modal="true" aria-label="${esc(c.name)}">
      <button type="button" class="mm-x" aria-label="Zavrieť">×</button>
      ${c.image ? '<img alt="">' : '<div class="ph"></div>'}
      <div>
        <h3>${esc(c.name)}</h3>
        <p>#${esc(c.number)}${c.rarity ? ' · ' + esc(c.rarity) : ''} · ${esc(tag)}<br>${esc(state.cur.name)}</p>
        <p class="mm-price">${it.price ? eur.format(it.price) : 'bez ceny'}</p>
        <p>${it.price ? '30-dňový priemer z Cardmarketu' : 'Cena tejto karty zatiaľ nie je dostupná.'}</p>
        ${c.cmUrl && /^https:\/\//.test(c.cmUrl) ? `<p><a class="mm-link" href="${esc(c.cmUrl)}" target="_blank" rel="noopener noreferrer">Otvoriť na Cardmarkete</a></p>` : ''}
        <button type="button" class="mm-own" aria-pressed="${m.own.has(key)}">${m.own.has(key) ? '✓ Mám' : 'Označiť, že ju mám'}</button>
      </div></div>`;
    const img = o.querySelector('img');
    if (img) {
      img.alt = c.name;
      img.referrerPolicy = 'no-referrer';
      img.addEventListener('error', () => { img.src = c.image; }, { once: true });
      img.src = bigImg(c.image);
    }
    o.addEventListener('click', (e) => { if (e.target === o || e.target.closest('.mm-x')) closePreview(); });
    o.querySelector('.mm-own').onclick = (e) => {
      toggleOwned(key);
      const has = m.own.has(key);
      e.currentTarget.setAttribute('aria-pressed', String(has));
      e.currentTarget.textContent = has ? '✓ Mám' : 'Označiť, že ju mám';
    };
    document.body.appendChild(o);
    o.querySelector('.mm-x').focus();
  }

  function renderMaster() {
    if (!state.m) mInit();
    const m = state.m;
    $('pane').innerHTML = `
      <div id="msum"></div>
      <div class="mctl">
        <div class="mgroup"><span class="mlabel">Zobrazenie</span>
          <div class="seg" role="group" aria-label="Zobrazenie"><button type="button" id="mvB">Binder</button><button type="button" id="mvL">Zoznam</button></div></div>
        <div class="mgroup" id="gsize"><span class="mlabel">Veľkosť binderu</span>
          <div class="seg" role="group" aria-label="Veľkosť binderu">${Object.keys(SIZES).map((k) => `<button type="button" data-size="${k}">${k.replace('x', '×')}</button>`).join('')}</div></div>
        ${m.hasRh ? `<div class="mgroup"><span class="mlabel">Zahrnúť karty</span>
          <div class="row"><button type="button" class="tog" id="trh">Reverse holo</button>
          <button type="button" class="tog" id="tdup" title="Karty bez reverse holo (napr. ex) sa v binderi zdvoja. Vypnuté: hneď za nimi nasleduje ďalšia karta.">Duplicate EX</button></div></div>` : ''}
        <div class="mgroup"><span class="mlabel">Ceny</span><div class="row"><button type="button" class="tog" id="tpr">Zobraziť ceny</button></div></div>
        <button type="button" class="ghost" id="mreset">Vynulovať</button>
      </div>
      <input id="mq" class="msearch" type="search" placeholder="Hľadať kartu (meno alebo číslo)" aria-label="Hľadať kartu" autocomplete="off" value="${esc(m.q)}">
      <div id="mview"></div>`;
    const change = (fn) => () => { fn(); m.page = 0; mPersist(); drawMasterView(); };
    $('mvB').onclick = () => { m.view = 'binder'; mPersist(); drawMasterView(); };
    $('mvL').onclick = () => { m.view = 'list'; mPersist(); drawMasterView(); };
    document.querySelectorAll('[data-size]').forEach((b) => { b.onclick = change(() => { m.size = b.dataset.size; }); });
    if (m.hasRh) {
      $('trh').onclick = change(() => { m.rh = !m.rh; });
      $('tdup').onclick = change(() => { m.dupe = !m.dupe; });
    }
    $('tpr').onclick = () => { m.prices = !m.prices; mPersist(); drawMasterView(); };
    $('mq').oninput = (e) => {
      m.q = e.target.value;
      if (m.view === 'list') drawRows();
      else binderSearch();
    };
    $('mreset').onclick = () => {
      if (!m.own.size || !confirm('Vynulovať všetky označené karty v tomto sete?')) return;
      m.own.clear();
      mPersist();
      drawMasterView();
    };
    // jeden poslucháč pre binder aj zoznam
    $('mview').onclick = (e) => {
      const z = e.target.closest('.zoom');
      if (z) { openPreview(z.dataset.zoom); return; }
      const t = e.target.closest('[data-turn]');
      if (t) { turnPage(Number(t.dataset.turn)); return; }
      const hit = e.target.closest('.hit');
      if (hit) toggleOwned(hit.closest('.slot').dataset.k);
    };
    $('mview').onchange = (e) => {
      if (e.target.id === 'bjump') { m.page = Number(e.target.value); drawBinder(masterSlots()); return; }
      const row = e.target.closest('.mrow[data-k]');
      if (row && e.target.matches('input[type="checkbox"]')) toggleOwned(row.dataset.k);
    };
    drawMasterView();
  }

  // pri zmene šírky okna (mobil/desktop) sa binder prekreslí z dvoch strán na jednu a naopak
  window.matchMedia('(min-width: 760px)').addEventListener('change', () => {
    if (state.tab === 'master' && state.m && state.m.view === 'binder' && $('mview')) drawBinder(masterSlots());
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('mmodal')) { closePreview(); return; }
    if ($('mmodal') || state.tab !== 'master' || !state.m || state.m.view !== 'binder' || $('detail').hidden) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.key === 'ArrowLeft') turnPage(-1);
    else if (e.key === 'ArrowRight') turnPage(1);
  });

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
    // #id alebo #id/master (id setu neobsahuje lomku)
    const [id, tab] = decodeURIComponent(location.hash.replace(/^#/, '')).split('/');
    if (id) openSet(id, tab || (MASTER ? 'master' : 'cards'));
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
