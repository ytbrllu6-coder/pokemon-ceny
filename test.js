'use strict';

// Jednoduché testy bez závislostí: node test.js
const assert = require('assert');
const { SHOPS, parseShopify, parseWoo, decodeEntities } = require('./shops');
const { parseListing } = require('./listing');
const { searchAll, normalize, expandQuery, correctQuery, matches, detect } = require('./search');

let passed = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log('  ok  ' + name); })
    .catch((e) => { console.error('FAIL  ' + name + '\n      ' + e.message); process.exitCode = 1; });
}

// Tvary odpovedí zodpovedajú skutočným odpovediam obchodov (skrátené)
const shopifyFixture = {
  resources: { results: { products: [
    { title: 'Pokémon TCG - 30th Anniversary Celebrations - Elite Trainer Box', price: '149.99', available: true,
      url: '/products/pokemon-30th-etb?_pos=1&_psq=elite', image: 'https://cdn.example/a.webp' },
    { title: 'Riftbound: Unleashed - Booster Box', price: '90.00', available: true, url: '/products/riftbound-bb' },
    { title: 'Pokémon: Pitch Black Elite Trainer box Mega Darkrai ex', price: '74.99', available: false,
      url: '/products/pitch-black-etb', featured_image: { url: 'https://cdn.example/b.webp' } },
  ] } },
};

const wooFixture = [
  { name: 'Pok&eacute;mon TCG &#8211; Delta Reign &#8211; Elite Trainer Box', permalink: 'https://shop.example/p/delta/',
    prices: { price: '0', currency_minor_unit: 2 }, images: [], is_in_stock: false },
  { name: 'Pokémon TCG &#8211; Chaos Rising &#8211; Elite Trainer box', permalink: 'https://shop.example/p/chaos/',
    prices: { price: '8500', currency_minor_unit: 2 }, images: [{ thumbnail: 'https://shop.example/t.jpg' }], is_in_stock: true },
];

(async () => {
  await test('normalize odstráni diakritiku', () => {
    assert.strictEqual(normalize('Pokémon TCG – Šarkan'), 'pokemon tcg sarkan');
  });

  await test('alias ETB sa rozvinie', () => {
    assert.strictEqual(expandQuery('etb chaos rising'), 'elite trainer box chaos rising');
  });

  await test('matches vyžaduje všetky slová', () => {
    assert.ok(matches('Pokémon Chaos Rising Elite Trainer Box', ['chaos', 'rising']));
    assert.ok(!matches('Pokémon Chaos Rising Elite Trainer Box', ['chaos', 'blaze']));
  });

  await test('krátke slovo "tin" sa nenájde vo vnútri slova Destined', () => {
    assert.ok(!matches('Pokémon Destined Rivals Booster', ['tin']));
    assert.ok(matches('Pokémon Mega Tin Charizard', ['tin']));
    assert.ok(matches('Pokémon Mini Tins', ['tin']));
  });

  await test('oprava preklepu: bandle -> bundle', () => {
    assert.strictEqual(correctQuery('booster bandle'), 'booster bundle');
    assert.strictEqual(correctQuery('elite trainer box'), 'elite trainer box');
    assert.strictEqual(correctQuery('charizard'), 'charizard');
  });

  await test('matches toleruje jeden preklep', () => {
    assert.ok(matches('Pokémon TCG - Booster Bundle', ['booster', 'bandle'] ));
    assert.ok(!matches('Pokémon TCG - Booster Box', ['booster', 'bundle']));
  });

  await test('decodeEntities', () => {
    assert.strictEqual(decodeEntities('A &#8211; B &amp; C'), 'A – B & C');
  });

  await test('parseShopify: cena, dostupnosť, čistá URL', () => {
    const r = parseShopify(shopifyFixture, 'https://www.cardyx.sk');
    assert.strictEqual(r.length, 3);
    assert.strictEqual(r[0].price, 149.99);
    assert.strictEqual(r[0].url, 'https://www.cardyx.sk/products/pokemon-30th-etb');
    assert.strictEqual(r[0].inStock, true);
    assert.strictEqual(r[2].inStock, false);
    assert.strictEqual(r[2].image, 'https://cdn.example/b.webp');
  });

  await test('parseWoo: cena v centoch, nulové ceny sa zahodia, entity sa dekódujú', () => {
    const r = parseWoo(wooFixture);
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].price, 85);
    assert.strictEqual(r[0].title, 'Pokémon TCG – Chaos Rising – Elite Trainer box');
    assert.strictEqual(r[0].inStock, true);
  });

  await test('searchAll: filtrovanie, zoradenie, najlacnejšie skladom, chyba obchodu', async () => {
    SHOPS.length = 0;
    SHOPS.push(
      { id: 'a', name: 'Obchod A', url: 'https://a', search: async () => parseShopify(shopifyFixture, 'https://a') },
      { id: 'b', name: 'Obchod B', url: 'https://b', search: async () => parseWoo(wooFixture) },
      { id: 'c', name: 'Obchod C', url: 'https://c', search: async () => { throw new Error('HTTP 503'); } }
    );
    const out = await searchAll('elite trainer box');
    // Riftbound sa vyfiltruje (nie Pokémon), 3 Pokémon ponuky ostanú
    assert.strictEqual(out.results.length, 3);
    // skladom najprv a od najlacnejšieho: 85 (B) potom 149.99 (A), nakoniec nedostupný 74.99
    assert.deepStrictEqual(out.results.map((r) => r.price), [85, 149.99, 74.99]);
    assert.strictEqual(out.results[0].cheapest, true);
    assert.strictEqual(out.results[1].cheapest, undefined);
    const c = out.shops.find((s) => s.id === 'c');
    assert.strictEqual(c.ok, false);
    assert.strictEqual(c.error, 'HTTP 503');

    const all = await searchAll('elite trainer box', { pokemonOnly: false });
    assert.strictEqual(all.results.length, 3); // Riftbound nemá "elite trainer box" v názve
    const bb = await searchAll('booster box', { pokemonOnly: false });
    assert.strictEqual(bb.results.length, 1);
    const bbPoke = await searchAll('booster box', { pokemonOnly: true });
    assert.strictEqual(bbPoke.results.length, 0);
  });

  await test('parseListing: cena s DPH, zľavy, dostupnosť, obrázky, kategórie sa ignorujú', () => {
    const html = `
    <div class="grid">
     <div><a href="/pokemon-tcg-30th-booster-box-4p286131"><img data-src="https://doc.smarty.sk/pic/a.webp" src="/img/loading.gif" alt="Pokémon TCG: 30th Celebration Booster Box (Japanese)"></a>
      <a href="/pokemon-tcg-30th-booster-box-4p286131" title="Pokémon TCG: 30th Celebration Booster Box (Japanese)">Pokémon TCG: 30th Celebration Booster Box (Japanese)</a>
      <span>Na sklade &gt; 5 ks</span><strong>263,90&nbsp;€</strong><small>214,55 € bez DPH</small></div>
     <div><a href="/pokemon-mini-tin-4p1"><img src="https://x.example/y.jpg"></a><a href="/pokemon-mini-tin-4p1">Pokémon Mini Tin</a>
      <del>20,00 €</del><b>15,00 €</b><i>Ušetríte 5,00 €</i> <span>Očakávame</span></div>
     <div><a href="/kategoria-c12">Kategória</a></div>
     <div><a href="/pokemon-deck-4p2">Pokémon Deck</a> 1 299,90 € Skladom</div>
    </div>`;
    const r = parseListing(html, { base: 'https://www.smarty.sk', linkRe: /-\d+p\d+$/ });
    assert.strictEqual(r.length, 3);
    assert.strictEqual(r[0].price, 263.9);
    assert.strictEqual(r[0].inStock, true);
    assert.strictEqual(r[0].image, 'https://doc.smarty.sk/pic/a.webp');
    assert.strictEqual(r[0].url, 'https://www.smarty.sk/pokemon-tcg-30th-booster-box-4p286131');
    assert.strictEqual(r[1].price, 15);
    assert.strictEqual(r[1].inStock, false);
    assert.strictEqual(r[2].price, 1299.9);
    assert.strictEqual(r[2].title, 'Pokémon Deck');
  });

  await test('detect: typ a edícia produktu', () => {
    const d = (x) => { const r = detect(x); return [r.type && r.type.id, r.edition]; };
    assert.deepStrictEqual(d('Pokémon TCG: Mega Evolution 05 Pitch Black Elite Trainer Box'), ['etb', 'Pitch Black']);
    assert.deepStrictEqual(d('Pokémon TCG: 30th Celebration Mini Tin Pikachu'), ['tin', '30th Celebration']);
    assert.deepStrictEqual(d('Pokémon: Mega Moonlit Tin Mega Gengar EX'), ['tin', 'Mega Evolution']);
    assert.deepStrictEqual(d('Pokémon TCG: Destined Rivals Booster Bundle'), ['bundle', 'Destined Rivals']);
    assert.deepStrictEqual(d('Pokémon TCG: Scarlet & Violet 151 Booster Pack'), ['booster', '151']);
    assert.deepStrictEqual(d('Pokémon TCG: Black Bolt Elite Trainer Box'), ['etb', 'Black Bolt']);
    assert.strictEqual(detect('Pokémon album A5').type, null);
  });

  await test('parseListing: prázdna stránka nevráti nič', () => {
    assert.deepStrictEqual(parseListing('<html><body>nič</body></html>', { base: 'https://x.sk', linkRe: /-p\d+$/ }), []);
  });

  await test('obchod na pozadí: najprv "načítava sa", potom výsledky z pamäte', async () => {
    SHOPS.length = 0;
    SHOPS.push({
      id: 'bg', name: 'BG', url: 'https://bg', background: true, ttlMs: 60000,
      crawl: async () => parseWoo(wooFixture),
    });
    const first = await searchAll('chaos rising');
    assert.strictEqual(first.shops[0].ok, false);
    assert.strictEqual(first.shops[0].loading, true);
    await new Promise((r) => setTimeout(r, 30));
    const second = await searchAll('chaos rising');
    assert.strictEqual(second.shops[0].ok, true);
    assert.strictEqual(second.results.length, 1);
    assert.strictEqual(second.results[0].price, 85);
  });

  console.log(`\n${passed} testov prešlo.`);
})();
