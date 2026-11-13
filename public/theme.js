'use strict';

/* Živšia stránka: vejár slávnych kariet a 3D naklonenie kariet pri myši. */
(() => {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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

  // Vejár slávnych kariet pod úvodnou sekciou: karta pod kurzorom vyskočí, kliknutie otvorí jej cenu
  const FAN = [
    ['base1', 4, 'Charizard'], ['base1', 2, 'Blastoise'], ['base1', 15, 'Venusaur'], ['base1', 58, 'Pikachu'],
    ['base1', 10, 'Mewtwo'], ['base1', 16, 'Zapdos'], ['base1', 1, 'Alakazam'], ['base1', 3, 'Chansey'],
  ];
  function fan() {
    const hero = document.querySelector('.hero');
    if (!hero || !['/', '/index.html', '/karty.html'].includes(location.pathname) || document.querySelector('.fanwrap')) return;
    const n = window.innerWidth < 700 ? 5 : 7;
    const pick = [...FAN].sort(() => Math.random() - 0.5).slice(0, n);
    const mid = (n - 1) / 2;
    const sec = document.createElement('section');
    sec.className = 'fanwrap';
    sec.setAttribute('aria-label', 'Slávne karty');
    sec.innerHTML = `<div class="wrap"><p class="fanhint">Slávne karty: klikni a zisti cenu</p><div class="fan">${pick.map(([set, num, name], i) => {
      const off = i - mid;
      return `<a class="fc" href="/karty.html?name=${encodeURIComponent(name)}&number=${num}&set=id.${set}" style="--r:${(off * 5).toFixed(1)}deg;--y:${(Math.abs(off) * Math.abs(off) * 3).toFixed(1)}px;z-index:${i + 1}" aria-label="${name}, cena karty">`
        + `<img src="https://images.pokemontcg.io/${set}/${num}.png" alt="${name}" loading="lazy" decoding="async" referrerpolicy="no-referrer"></a>`;
    }).join('')}</div></div>`;
    sec.querySelectorAll('img').forEach((img) => img.addEventListener('error', () => { img.closest('.fc').style.display = 'none'; }));
    hero.classList.add('has-fan');
    hero.insertAdjacentElement('afterend', sec);
  }

  fan();
  tilt();
})();
