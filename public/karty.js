'use strict';

/* Cena karty: kamera (rozpoznanie samo) alebo meno a číslo ručne. Text z obrázka sa číta v prehliadači (tesseract.js). */
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const eur = new Intl.NumberFormat('sk-SK', { style: 'currency', currency: 'EUR' });
  const P = window.CardParse;
  const out = $('out');
  const statusEl = $('status');
  const state = { cands: [], idx: 0 };
  const CARD_RATIO = 63 / 88; // šírka / výška karty
  let tessPromise = null;
  let stream = null;
  let worker = null;
  let scanning = false;
  let guideRect = null;

  const fmt = (v) => (v == null ? '–' : eur.format(v));
  const setStatus = (t) => { statusEl.textContent = t || ''; };

  try {
    const saved = Number(localStorage.getItem('pokeceny.pct'));
    if (saved >= 1 && saved <= 200) $('cPct').value = String(saved);
  } catch { /* bez ukladania */ }
  const pct = () => {
    const v = Number($('cPct').value);
    return v >= 1 && v <= 200 ? v : 90;
  };

  // ---------- rozpoznávanie textu ----------
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

  async function getWorker() {
    if (!worker) {
      const T = await loadTesseract();
      worker = await T.createWorker('eng');
    }
    return worker;
  }

  function dropWorker() {
    if (worker) Promise.resolve(worker.terminate()).catch(() => {});
    worker = null;
  }

  // výrez, šedá, kontrast, pri tmavom pozadí inverzia
  function region(base, x, y, w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(base, x, y, w, h, 0, 0, c.width, c.height);
    const data = ctx.getImageData(0, 0, c.width, c.height);
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

  // prečíta názov (horný pás) a číslo (spodný pás) z obrázka karty (rect = oblasť karty v zdroji)
  async function readCard(source, rect) {
    const w = await getWorker();
    const { x, y, w: cw, h: ch } = rect;
    const nameText = (await w.recognize(region(source, x, y, cw, Math.round(ch * 0.16)))).data.text;
    const botY = y + Math.round(ch * 0.86);
    const numText = (await w.recognize(region(source, x, botY, cw, Math.round(ch * 0.14)))).data.text;
    return { name: P.parseName(nameText), num: P.parseNumber(numText) };
  }

  // ---------- kamera ----------
  function placeGuide() {
    const v = $('video');
    const vw = v.videoWidth;
    const vh = v.videoHeight;
    if (!vw || !vh) return;
    $('stage').style.aspectRatio = `${vw} / ${vh}`;
    let h = vh * 0.9;
    let w = h * CARD_RATIO;
    if (w > vw * 0.92) {
      w = vw * 0.92;
      h = w / CARD_RATIO;
    }
    const x = (vw - w) / 2;
    const y = (vh - h) / 2;
    guideRect = { x, y, w, h };
    const g = $('guide');
    g.style.left = `${(x / vw) * 100}%`;
    g.style.top = `${(y / vh) * 100}%`;
    g.style.width = `${(w / vw) * 100}%`;
    g.style.height = `${(h / vh) * 100}%`;
  }

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('Tento prehliadač nepodporuje kameru. Použi „Nahrať fotku“ alebo zadaj meno a číslo.');
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
    } catch {
      setStatus('Kamera sa nespustila. Povoľ prístup ku kamere v prehliadači, alebo použi „Nahrať fotku“.');
      return;
    }
    const v = $('video');
    v.srcObject = stream;
    await v.play().catch(() => {});
    if (v.videoWidth) placeGuide();
    else v.addEventListener('loadedmetadata', placeGuide, { once: true });
    $('cam').classList.add('on');
    out.innerHTML = '';
    setStatus('Priprav si kartu do rámčeka a drž ju rovno. Rozpoznám ju sama.');
    scanning = true;
    scanLoop();
  }

  function stopCamera() {
    scanning = false;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    $('video').srcObject = null;
    $('cam').classList.remove('on');
    dropWorker();
  }

  function grabFrame() {
    const v = $('video');
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    return c;
  }

  async function scanLoop() {
    let tries = 0;
    let lastName = null;
    while (scanning) {
      const v = $('video');
      if (!v.videoWidth || !guideRect) {
        await new Promise((r) => setTimeout(r, 300));
        continue;
      }
      try {
        setStatus(tries ? 'Hľadám kartu… drž ju rovno a bez odleskov.' : 'Pripravujem rozpoznávanie…');
        const res = await readCard(grabFrame(), guideRect);
        if (!scanning) return;
        tries++;
        if (res.name) lastName = res.name;
        if (res.num || (lastName && tries >= 8)) {
          await finishScan(res.name || lastName, res.num);
          return;
        }
      } catch (err) {
        if (scanning) setStatus(err.message || 'Rozpoznávanie zlyhalo.');
        scanning = false;
        return;
      }
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  async function finishScan(name, num) {
    stopCamera();
    if (name) $('cName').value = name;
    if (num) $('cNum').value = `${num.number}/${num.total}`;
    await lookup();
  }

  // odfotenie na požiadanie (tlačidlo „Odfotiť teraz“)
  async function snapNow() {
    if (!guideRect) return;
    try {
      setStatus('Čítam kartu…');
      const res = await readCard(grabFrame(), guideRect);
      if (!res.name && !res.num) {
        setStatus('Kartu sa nepodarilo prečítať. Drž ju rovno v rámčeku a skús znova.');
        return;
      }
      await finishScan(res.name, res.num);
    } catch (err) {
      setStatus(err.message || 'Rozpoznávanie zlyhalo.');
    }
  }

  // ---------- fotka zo súboru ----------
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve({ img, url });
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Fotku sa nepodarilo otvoriť.')); };
      img.src = url;
    });
  }

  async function onPhoto(file) {
    if (!file) return;
    stopCamera();
    out.innerHTML = '';
    try {
      const { img, url } = await loadImage(file);
      const scale = Math.min(1, 1600 / img.naturalWidth);
      const W = Math.round(img.naturalWidth * scale);
      const H = Math.round(img.naturalHeight * scale);
      const base = document.createElement('canvas');
      base.width = W;
      base.height = H;
      base.getContext('2d').drawImage(img, 0, 0, W, H);
      URL.revokeObjectURL(url);
      setStatus('Čítam kartu…');
      const res = await readCard(base, { x: 0, y: 0, w: W, h: H });
      dropWorker();
      if (!res.name && !res.num) {
        setStatus('Z fotky sa nepodarilo prečítať kartu. Odfoť ju zblízka a rovno, alebo zadaj meno a číslo ručne.');
        return;
      }
      if (res.name) $('cName').value = res.name;
      if (res.num) $('cNum').value = `${res.num.number}/${res.num.total}`;
      await lookup();
    } catch (err) {
      dropWorker();
      setStatus(err.message || 'Fotku sa nepodarilo spracovať.');
    }
  }

  // ---------- vyhľadanie ceny ----------
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
    if (!name && !(np && np.total)) {
      setStatus(np ? 'K číslu doplň aj meno karty, alebo napíš číslo aj s počtom kariet v sete (napr. 4/134).' : 'Zadaj meno karty a číslo (napr. 4).');
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
      setStatus(d.cards.length ? '' : 'Nenašla sa žiadna karta. Skontroluj meno a číslo.');
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

  // ---------- udalosti ----------
  $('camBtn').addEventListener('click', () => { if (!stream) startCamera(); });
  $('camStop').addEventListener('click', () => { stopCamera(); setStatus(''); });
  $('snap').addEventListener('click', snapNow);
  $('shotPick').addEventListener('change', (e) => { onPhoto(e.target.files[0]); e.target.value = ''; });
  $('cardForm').addEventListener('submit', (e) => { e.preventDefault(); stopCamera(); lookup(); });
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
  window.addEventListener('pagehide', stopCamera);

  const q = new URLSearchParams(location.search);
  if (q.get('name') || q.get('number')) {
    $('cName').value = q.get('name') || '';
    $('cNum').value = q.get('number') || '';
    lookup();
  }
})();
