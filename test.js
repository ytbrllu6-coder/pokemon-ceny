'use strict';

// Jednoduché testy bez závislostí: node test.js
const assert = require('assert');
const { SHOPS, parseShopify, parseWoo, decodeEntities } = require('./shops');
const { searchAll, normalize, expandQuery, correctQuery, matches } = require('./search');

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

  console.log(`\n${passed} testov prešlo.`);
})();
