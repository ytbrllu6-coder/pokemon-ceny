'use strict';

/* Spracovanie textu prečítaného z fotky karty. Funguje v prehliadači aj v Node (testy). */
(function (root) {
  function lev(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
    }
    return d[a.length][b.length];
  }

  // "045/198", "4 / 102" -> { number: "45", total: "198" }
  function parseNumber(text) {
    const m = /(\d{1,3})\s*[\/|\\]\s*(\d{2,3})/.exec(String(text || ''));
    if (!m) return null;
    const number = Number(m[1]);
    const total = Number(m[2]);
    if (!number || !total) return null;
    return { number: String(number), total: String(total) };
  }

  // Z horného pásu karty vyberie riadok s názvom (bez "Basic", "Stage 2", HP a čísel)
  function parseName(text) {
    const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    let best = '';
    let bestLetters = 0;
    for (const raw of lines) {
      if (/^evolves?\s+from/i.test(raw)) continue;
      const cleaned = raw
        .replace(/\b(basic|stage\s*\d?|hp)\b/gi, ' ')
        .replace(/[^A-Za-zÀ-ž'’\- ]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const letters = (cleaned.match(/[A-Za-zÀ-ž]/g) || []).length;
      if (letters >= 3 && letters > bestLetters) {
        best = cleaned;
        bestLetters = letters;
      }
    }
    return best || null;
  }

  // Index karty, ktorej názov sa najviac podobá na prečítaný názov
  function bestIndex(cards, name) {
    const want = (String(name || '').toLowerCase().match(/[a-z]{3,}/g) || [])[0];
    if (!want || !cards.length) return 0;
    let best = 0;
    let bestScore = Infinity;
    cards.forEach((c, i) => {
      const have = (String(c.name || '').toLowerCase().match(/[a-z]{3,}/g) || [])[0] || '';
      const score = lev(want, have);
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    });
    return best;
  }

  const api = { parseNumber, parseName, bestIndex, lev };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CardParse = api;
})(typeof window !== 'undefined' ? window : globalThis);
