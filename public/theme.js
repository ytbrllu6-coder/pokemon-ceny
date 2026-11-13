'use strict';

/* Živšia stránka: skackajúci Pokémoni v úvodnej sekcii (klikni a zmení sa) a 3D naklonenie kariet pri myši. */
(() => {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // animované spriteky z verejného repozitára PokéAPI (Pokémoni 1 až 649); ak sa nenačítajú, jednoducho sa skryjú
  const SPRITE = (id) => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-v/black-white/animated/${id}.gif`;
  const rnd = () => 1 + Math.floor(Math.random() * 649);

  function sprites() {
    const hero = document.querySelector('.hero');
    if (!hero || hero.querySelector('.sprites')) return;
    const row = document.createElement('div');
    row.className = 'sprites';
    row.setAttribute('aria-hidden', 'true');
    const count = window.innerWidth < 700 ? 4 : 7;
    for (let i = 0; i < count; i++) {
      const img = document.createElement('img');
      img.className = 'spr';
      img.alt = '';
      img.decoding = 'async';
      img.style.left = `${(i + 0.5) * (100 / count)}%`;
      img.style.animationDelay = `${(i * 0.37) % 1.4}s`;
      img.addEventListener('error', () => { img.style.display = 'none'; });
      img.addEventListener('load', () => { img.style.display = ''; });
      img.src = SPRITE(rnd());
      img.addEventListener('click', () => {
        img.classList.remove('pop');
        void img.offsetWidth;
        img.classList.add('pop');
        img.src = SPRITE(rnd());
      });
      row.appendChild(img);
    }
    hero.appendChild(row);
  }

  // jemné 3D naklonenie kariet za kurzorom (len pre myš)
  function tilt() {
    if (reduce || !window.matchMedia('(hover: hover)').matches) return;
    let el = null;
    document.addEventListener('pointermove', (e) => {
      const t = e.target.closest && e.target.closest('.card, .cardres > img, .slot');
      if (el && el !== t) { el.style.transform = ''; el = null; }
      if (!t) return;
      const r = t.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      t.style.transform = `perspective(700px) rotateX(${(-y * 8).toFixed(2)}deg) rotateY(${(x * 8).toFixed(2)}deg) translateY(-4px)`;
      el = t;
    }, { passive: true });
    document.addEventListener('pointerleave', () => { if (el) { el.style.transform = ''; el = null; } });
  }

  sprites();
  tilt();
})();
