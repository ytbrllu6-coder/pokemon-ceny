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
  // Čo kartu máš sa ukladá v prehliadači (localStorage), samostatne pre každý set.
  const MKEY = 'pokeceny.master';
  const mload = () => {
    try {
      const d = JSON.parse(localStorage.getItem(MKEY) || '{}');
      return d && typeof d === 'object' ? d : {};
    } catch { return {}; }
  };
  const msave = (d) => { try { localStorage.setItem(MKEY, JSON.stringify(d)); } catch { /* bez ukladania */ } };

  function mInit() {
    const store = mload();
    const rec = (store.sets || {})[state.cur.id] || {};
    state.m = {
      own: new Set(Array.isArray(rec.own) ? rec.own : []),
      rh: !!rec.rh,
      view: store.view === 'list' ? 'list' : 'binder',
      per: store.per === 12 ? 12 : 9,
      page: 0,
      filter: 'all',
      q: '',
    };
  }

  function mPersist() {
    const store = mload();
    store.sets = store.sets || {};
    store.sets[state.cur.id] = { own: [...state.m.own], rh: state.m.rh };
    store.view = state.m.view;
    store.per = state.m.per;
    msave(store);
  }

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

  function masterItems() {
    const sorted = [...state.cards.cards].sort(cmpNum);
    const items = sorted.map((c) => ({ key: c.id, c, rh: false, price: c.avg30 || null }));
    if (state.m.rh) {
      for (const c of sorted) if (rhEligible(c)) items.push({ key: c.id + ':rh', c, rh: true, price: c.reverse || null });
    }
    return items;
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
    const base = items.filter((i) => !i.rh);
    const extra = total ? base.filter((i) => { const [p, n] = splitNum(i.c.number); return p !== '' || n > total; }).length : 0;
    $('msum').innerHTML = `
      <div class="mprog" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><div class="mfill" style="width:${pct}%"></div></div>
      <div class="mnums"><b>${st.have} / ${st.total}</b> <span>${pct} % hotovo</span>
        <span>Hodnota tvojich kariet: ${eur.format(st.haveVal)}</span>
        <span>Dokúpiť zhruba: ${eur.format(st.missVal)}</span></div>
      <p class="note">${total ? `Set má ${esc(total)} očíslovaných kariet${extra ? `, master set ich má ${base.length} (vrátane ${extra} secret rare a špeciálnych nad toto číslovanie)` : ''}. ` : ''}Ceny sú 30-dňový priemer z Cardmarketu${st.noPrice ? `; u ${st.noPrice} kariet cena chýba, do súčtov sa nepočíta` : ''}.</p>
      <div class="chips">${[...st.rar].map(([r, g]) => `<span class="chip${g.have === g.n ? ' done' : ''}">${esc(r)} ${g.have}/${g.n}</span>`).join('')}</div>`;
  }

  const slotImg = (c) => (c.image ? `<img src="${esc(c.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span class="ph"></span>');

  function drawBinder(items) {
    const m = state.m;
    const spread = window.matchMedia('(min-width: 760px)').matches;
    const pages = Math.max(1, Math.ceil(items.length / m.per));
    m.page = Math.min(Math.max(0, m.page), pages - 1);
    if (spread) m.page -= m.page % 2;
    const step = spread ? 2 : 1;
    const cols = m.per === 12 ? 4 : 3;
    const pageHtml = (p) => {
      if (p >= pages) return '<div class="bpage blank"></div>';
      const slice = items.slice(p * m.per, (p + 1) * m.per);
      const slots = slice.map((it) => {
        const own = m.own.has(it.key);
        const label = `${it.c.name} #${it.c.number}${it.rh ? ' (reverse holo)' : ''}`;
        return `<button type="button" class="slot${own ? ' own' : ''}${it.rh ? ' rh' : ''}" data-k="${esc(it.key)}" aria-pressed="${own}" aria-label="${esc(label)}" title="${esc(label)}${it.price ? ' · ' + eur.format(it.price) : ''}">
          ${slotImg(it.c)}<span class="sn">#${esc(it.c.number)}${it.rh ? ' RH' : ''}</span><span class="sname">${esc(it.c.name)}</span></button>`;
      });
      for (let i = slice.length; i < m.per; i++) slots.push('<span class="slot void"><span class="ph"></span><span class="sn">&nbsp;</span><span class="sname">&nbsp;</span></span>');
      return `<div class="bpage c${cols}">${slots.join('')}<span class="pn">Strana ${p + 1} z ${pages}</span></div>`;
    };
    const opts = [];
    for (let p = 0; p < pages; p += step) {
      const first = items[p * m.per], last = items[Math.min(items.length, (p + step) * m.per) - 1];
      opts.push(`<option value="${p}"${p === m.page ? ' selected' : ''}>Strana ${spread && p + 1 < pages ? `${p + 1}–${p + 2}` : p + 1} (#${esc(first.c.number)} – #${esc(last.c.number)})</option>`);
    }
    $('mview').innerHTML = `
      <div class="bnav">
        <button type="button" id="bprev"${m.page <= 0 ? ' disabled' : ''} aria-label="Predchádzajúca strana">←</button>
        <select id="bjump" aria-label="Prejsť na stranu">${opts.join('')}</select>
        <button type="button" id="bnext"${m.page + step >= pages ? ' disabled' : ''} aria-label="Ďalšia strana">→</button>
      </div>
      <div class="binder${spread ? ' spread' : ''}">${spread ? pageHtml(m.page) + pageHtml(m.page + 1) : pageHtml(m.page)}</div>
      <p class="note" style="margin-top:12px">Kliknutím na kartu ju označíš, že ju máš. Sivé karty ešte chýbajú. Šípky na klávesnici listujú stranami.</p>`;
    const turn = (to) => { m.page = to; drawBinder(masterItems()); };
    $('bprev').onclick = () => turn(m.page - step);
    $('bnext').onclick = () => turn(m.page + step);
    $('bjump').onchange = (e) => turn(Number(e.target.value));
  }

  function drawList(items) {
    const m = state.m;
    $('mview').innerHTML = `
      <div class="tools">
        <input id="mq" type="search" placeholder="Hľadať kartu v zozname" autocomplete="off" value="${esc(m.q)}">
        <select id="mf" aria-label="Filter">
          <option value="all">Všetky</option>
          <option value="own">Mám</option>
          <option value="missing">Chýbajú</option>
        </select>
      </div>
      <div id="mrows" class="mrows"></div>`;
    $('mf').value = m.filter;
    $('mq').oninput = (e) => { m.q = e.target.value; drawRows(); };
    $('mf').onchange = (e) => { m.filter = e.target.value; drawRows(); };
    drawRows();
  }

  function drawRows() {
    const m = state.m;
    const f = m.q.trim().toLowerCase();
    const list = masterItems().filter((it) => {
      const own = m.own.has(it.key);
      if (m.filter === 'own' && !own) return false;
      if (m.filter === 'missing' && own) return false;
      return !f || `${it.c.name} ${it.c.number} ${it.c.rarity || ''}`.toLowerCase().includes(f);
    });
    let html = '';
    let rhHead = false;
    for (const it of list) {
      if (it.rh && !rhHead) { html += '<h3>Reverse holo varianty</h3>'; rhHead = true; }
      const own = m.own.has(it.key);
      html += `<label class="mrow${own ? ' own' : ''}" data-k="${esc(it.key)}">
        <input type="checkbox"${own ? ' checked' : ''}>
        ${slotImg(it.c)}
        <span><b>${esc(it.c.name)}${it.rh ? ' (reverse holo)' : ''}</b><small>#${esc(it.c.number)}${it.c.rarity ? ' · ' + esc(it.c.rarity) : ''}</small></span>
        <span class="mp">${it.price ? eur.format(it.price) : '<small>bez ceny</small>'}</span></label>`;
    }
    $('mrows').innerHTML = html || '<p class="empty">Žiadna karta nesedí na filter.</p>';
  }

  function drawMasterView() {
    const items = masterItems();
    drawSummary(items);
    if (!items.length) $('mview').innerHTML = '<p class="empty">Tento set nemá žiadne karty na zobrazenie.</p>';
    else if (state.m.view === 'binder') drawBinder(items);
    else drawList(items);
    $('mvB').setAttribute('aria-pressed', String(state.m.view === 'binder'));
    $('mvL').setAttribute('aria-pressed', String(state.m.view === 'list'));
    $('mper').hidden = state.m.view !== 'binder';
  }

  function toggleOwned(key) {
    const m = state.m;
    if (m.own.has(key)) m.own.delete(key);
    else m.own.add(key);
    mPersist();
    const has = m.own.has(key);
    drawSummary(masterItems());
    if (m.view === 'list' && m.filter !== 'all') { drawRows(); return; }
    for (const el of $('mview').querySelectorAll('[data-k]')) {
      if (el.dataset.k !== key) continue;
      el.classList.toggle('own', has);
      if (el.matches('.slot')) el.setAttribute('aria-pressed', String(has));
      const box = el.querySelector('input');
      if (box) box.checked = has;
    }
  }

  function renderMaster() {
    if (!state.m) mInit();
    const m = state.m;
    const canRh = rhPossible();
    if (!canRh) m.rh = false;
    $('pane').innerHTML = `
      <div id="msum"></div>
      <div class="mbar">
        <div class="seg" role="group" aria-label="Zobrazenie">
          <button type="button" id="mvB">Binder</button>
          <button type="button" id="mvL">Zoznam</button>
        </div>
        <select id="mper" aria-label="Veľkosť strany binderu">
          <option value="9">Strana 3×3</option>
          <option value="12">Strana 4×3</option>
        </select>
        ${canRh ? `<label class="chk" title="Odhad: Common, Uncommon a Rare majú reverse holo variant"><input type="checkbox" id="mrh"${m.rh ? ' checked' : ''}> Aj reverse holo</label>` : ''}
        <button type="button" class="ghost" id="mreset">Vynulovať</button>
      </div>
      <div id="mview"></div>`;
    $('mper').value = String(m.per);
    $('mvB').onclick = () => { m.view = 'binder'; mPersist(); drawMasterView(); };
    $('mvL').onclick = () => { m.view = 'list'; mPersist(); drawMasterView(); };
    $('mper').onchange = (e) => { m.per = Number(e.target.value) === 12 ? 12 : 9; m.page = 0; mPersist(); drawMasterView(); };
    if (canRh) {
      $('mrh').onchange = (e) => { m.rh = e.target.checked; m.page = 0; mPersist(); drawMasterView(); };
    }
    $('mreset').onclick = () => {
      if (!m.own.size || !confirm('Vynulovať všetky označené karty v tomto sete?')) return;
      m.own.clear();
      mPersist();
      drawMasterView();
    };
    // jeden poslucháč pre kliknutia na karty v binderi aj v zozname
    $('mview').onclick = (e) => {
      const slot = e.target.closest('.slot[data-k]');
      if (slot) toggleOwned(slot.dataset.k);
    };
    $('mview').onchange = (e) => {
      const row = e.target.closest('.mrow[data-k]');
      if (row && e.target.matches('input[type="checkbox"]')) toggleOwned(row.dataset.k);
    };
    drawMasterView();
  }

  // pri zmene šírky okna (mobil/desktop) sa binder prekreslí z dvoch strán na jednu a naopak
  window.matchMedia('(min-width: 760px)').addEventListener('change', () => {
    if (state.tab === 'master' && state.m && state.m.view === 'binder' && $('mview')) drawBinder(masterItems());
  });
  document.addEventListener('keydown', (e) => {
    if (state.tab !== 'master' || !state.m || state.m.view !== 'binder' || $('detail').hidden) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    const btn = e.key === 'ArrowLeft' ? $('bprev') : e.key === 'ArrowRight' ? $('bnext') : null;
    if (btn && !btn.disabled) btn.click();
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
