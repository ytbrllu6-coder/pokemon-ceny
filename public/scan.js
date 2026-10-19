'use strict';

/* Skenovanie karty: fotka -> text (tesseract.js priamo v telefóne) -> cena z Cardmarketu */
(() => {
  const P = window.CardParse;
  const dlg = $('scan');
  const out = $('scanOut');
  const statusEl = $('scanStatus');
  const state = { cands: [], idx: 0 };
  let tessPromise = null;

  const fmt = (v) => (v == null ? '–' : eur.format(v));
  const setStatus = (t) => { statusEl.textContent = t || ''; };

  // percento, ktoré používateľ uplatňuje z 30-dňového priemeru (pamätá sa v prehliadači)
  try {
    const saved = Number(localStorage.getItem('pokeceny.pct'));
    if (saved >= 1 && saved <= 200) $('cPct').value = String(saved);
  } catch { /* bez ukladania */ }
  const pct = () => {
    const v = Number($('cPct').value);
    return v >= 1 && v <= 200 ? v : 90;
  };

  function loadTesseract() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (!tessPromise) {
      tessPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
        s.onload = () => resolve(window.Tesseract);
        s.onerror = () => {
          tessPromise = null;
          reject(new Error('Nepodarilo sa načítať rozpoznávanie textu. Skontroluj pripojenie alebo zadaj údaje ručne.'));
        };
        document.head.appendChild(s);
      });
    }
    return tessPromise;
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve({ img, url });
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Fotku sa nepodarilo otvoriť.')); };
      img.src = url;
    });
  }

  // výrez, šedá, zvýšený kontrast, pri tmavom pozadí inverzia (lepšie čítanie textu)
  function region(base, x, y, w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(base, x, y, w, h, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h);
    const px = data.data;
    let sum = 0;
    for (let i = 0; i < px.length; i += 4) {
      const g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      px[i] = px[i + 1] = px[i + 2] = g;
      sum += g;
    }
    const invert = sum / (px.length / 4) < 110;
    for (let i = 0; i < px.length; i += 4) {
      let v = (px[i] - 128) * 1.5 + 128;
      v = Math.max(0, Math.min(255, v));
      if (invert) v = 255 - v;
      px[i] = px[i + 1] = px[i + 2] = v;
    }
    ctx.putImageData(data, 0, 0);
    return c;
  }

  async function readPhoto(file) {
    const { img, url } = await loadImage(file);
    $('scanPreview').innerHTML = `<img src="${url}" alt="Fotka karty">`;
    const scale = Math.min(1, 1400 / img.naturalWidth);
    const W = Math.round(img.naturalWidth * scale);
    const H = Math.round(img.naturalHeight * scale);
    const base = document.createElement('canvas');
    base.width = W;
    base.height = H;
    base.getContext('2d').drawImage(img, 0, 0, W, H);

    setStatus('Pripravujem rozpoznávanie textu…');
    const T = await loadTesseract();
    const worker = await T.createWorker('eng');
    try {
      setStatus('Čítam názov karty…');
      const topH = Math.round(H * 0.16);
      const nameText = (await worker.recognize(region(base, 0, 0, W, topH))).data.text;
      setStatus('Čítam číslo karty…');
      const botY = Math.round(H * 0.86);
      const numText = (await worker.recognize(region(base, 0, botY, W, H - botY))).data.text;
      return { name: P.parseName(nameText), num: P.parseNumber(numText) };
    } finally {
      Promise.resolve(worker.terminate()).catch(() => {});
    }
  }

  async function onPhoto(file) {
    if (!file) return;
    out.innerHTML = '';
    try {
      const { name, num } = await readPhoto(file);
      if (name) $('cName').value = name;
      if (num) $('cNum').value = `${num.number}/${num.total}`;
      if (!name && !num) {
        setStatus('Z fotky sa nepodarilo prečítať kartu. Odfoť ju zblízka a rovno, alebo doplň názov a číslo ručne.');
        return;
      }
      await lookup();
    } catch (err) {
      setStatus(err.message || 'Fotku sa nepodarilo spracovať. Doplň názov a číslo ručne.');
    }
  }

  async function lookup() {
    const name = $('cName').value.trim();
    const raw = $('cNum').value.trim();
    let np = P.parseNumber(raw);
    if (!np && /^\d{1,3}$/.test(raw) && Number(raw) > 0) np = { number: String(Number(raw)), total: null };

    const params = new URLSearchParams();
    if (name) params.set('name', name);
    if (np) {
      params.set('number', np.number);
      if (np.total) params.set('total', np.total);
    }
    if (![...params.keys()].length) {
      setStatus('Zadaj názov karty alebo celé číslo (napr. 123/191).');
      return;
    }

    setStatus('Hľadám cenu na Cardmarkete (môže to trvať aj 20 sekúnd)…');
    out.innerHTML = '<div class="skel"></div>';
    try {
      const res = await fetch('/api/card?' + params);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Chyba servera');
      state.cands = d.cards;
      state.idx = P.bestIndex(d.cards, name);
      setStatus(d.cards.length ? '' : 'Nenašla sa žiadna karta. Skontroluj názov a číslo.');
      render();
    } catch (err) {
      state.cands = [];
      out.innerHTML = '';
      setStatus(err.message);
    }
  }

  function render() {
    const c = state.cands[state.idx];
    if (!c) {
      out.innerHTML = '';
      return;
    }
    const p = pct();
    const own = c.avg30 ? Math.round(c.avg30 * p) / 100 : null;

    const strip = state.cands.length > 1
      ? `<div class="cands" role="list" aria-label="Ďalšie nájdené karty">${state.cands.map((x, i) => `
          <button type="button" role="listitem" class="cand ${i === state.idx ? 'on' : ''}" data-i="${i}" aria-label="${esc(x.name)}, ${esc(x.setName || '')} ${esc(x.number)}">
            ${x.image ? `<img src="${esc(x.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
            <span>${esc(x.setCode || x.setName || '')} ${esc(x.number)}</span>
          </button>`).join('')}</div>`
      : '';

    out.innerHTML = `
      ${strip}
      <article class="cardres">
        ${c.image ? `<img src="${esc(c.image)}" alt="${esc(c.name)}" referrerpolicy="no-referrer">` : '<div class="ph"></div>'}
        <div class="cardinfo">
          <h3>${esc(c.name)}</h3>
          <p>${esc(c.setName || '')}${c.setName ? ', ' : ''}č. ${esc(c.number)}${c.setTotal ? '/' + esc(c.setTotal) : ''}${c.rarity ? ', ' + esc(c.rarity) : ''}</p>
        </div>
        ${c.avg30 ? `
        <div class="own">
          <span class="lbl">Tvoja cena (${p} % z priemeru)</span>
          <span class="big">${fmt(own)}</span>
        </div>
        <div class="avg">
          <span class="lbl">Cardmarket, 30-dňový priemer</span>
          <span class="mid">${fmt(c.avg30)}</span>
        </div>` : `
        <div class="own"><span class="lbl">Cardmarket nemá pre túto kartu 30-dňový priemer</span></div>`}
        <dl class="more">
          <div><dt>Trend</dt><dd>${fmt(c.trend)}</dd></div>
          <div><dt>7 dní</dt><dd>${fmt(c.avg7)}</dd></div>
          <div><dt>1 deň</dt><dd>${fmt(c.avg1)}</dd></div>
          <div><dt>Najnižšia</dt><dd>${fmt(c.low)}</dd></div>
          ${c.reverseAvg30 ? `<div><dt>Reverse holo, 30 dní</dt><dd>${fmt(c.reverseAvg30)}</dd></div>` : ''}
        </dl>
        <p class="upd">${c.updated ? 'Ceny aktualizované ' + esc(c.updated) + '. ' : ''}Zdroj: Cardmarket cez Pokémon TCG API.</p>
        ${c.cmUrl && /^https?:\/\//i.test(c.cmUrl) ? `<a class="go" href="${esc(c.cmUrl)}" target="_blank" rel="noopener noreferrer">Otvoriť na Cardmarkete</a>` : ''}
      </article>`;
  }

  // ----- udalosti -----
  $('scanBtn').addEventListener('click', () => dlg.showModal());
  $('scanClose').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  $('shotCam').addEventListener('change', (e) => { onPhoto(e.target.files[0]); e.target.value = ''; });
  $('shotPick').addEventListener('change', (e) => { onPhoto(e.target.files[0]); e.target.value = ''; });
  $('scanForm').addEventListener('submit', (e) => { e.preventDefault(); lookup(); });
  $('cPct').addEventListener('input', () => {
    try { localStorage.setItem('pokeceny.pct', String(pct())); } catch { /* bez ukladania */ }
    render();
  });
  out.addEventListener('click', (e) => {
    const b = e.target.closest('[data-i]');
    if (b) {
      state.idx = Number(b.dataset.i);
      render();
    }
  });
})();
