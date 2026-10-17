# Pokémon ceny SK

Webová appka: zadáš Pokémon produkt (napr. „Elite Trainer Box Destined Rivals“) a appka prehľadá slovenské e-shopy a zoradí ponuky od najlacnejšej (skladom najprv).

## Spustenie

Potrebuješ Node.js 18 alebo novší (žiadne `npm install` netreba).

```bash
node server.js
```

Potom otvor http://localhost:3000 (iný port: `PORT=8080 node server.js`).

Testy: `node test.js`

## Ako to funguje

- `server.js` – HTTP server, endpoint `/api/search?q=...` a statická stránka z `public/`
- `search.js` – paralelné dopytovanie obchodov, filtrovanie podľa všetkých zadaných slov, zoradenie, cache (10 min) a spomalenie (min. 1 s medzi požiadavkami na ten istý obchod)
- `shops.js` – adaptéry obchodov
- `public/index.html` – rozhranie

Skratky: `etb` = elite trainer box, `upc` = ultra premium collection, `bb` = booster box.

## Zapojené obchody

| Obchod | Spôsob |
|---|---|
| cardyx.sk | Shopify `/search/suggest.json` |
| 64ka.sk | Shopify `/search/suggest.json` |
| 365tcg.sk | WooCommerce Store API |

Použité sú len verejné vyhľadávacie rozhrania, ktoré robots.txt daného obchodu nezakazuje.

### Pridanie ďalšieho obchodu

V `shops.js` pridaj riadok do poľa `SHOPS`:

```js
shopify({ id: 'mojobchod', name: 'Môj obchod', base: 'https://www.mojobchod.sk' }),
woocommerce({ id: 'iny', name: 'Iný', base: 'https://iny.sk' }),
```

Pred pridaním skontroluj `https://obchod.sk/robots.txt` – ak zakazuje vyhľadávanie alebo API, obchod radšej nepridávaj.

### Vedome vynechané

Alza.sk a Kaufland.sk automatizovaný prístup výslovne zakazujú. Heureka.sk obmedzuje vyhľadávanie v robots.txt. Nekonecno.sk, smarty.sk, cardempire.sk, beardex.eu a pokecardsk.sk majú v robots.txt zakázané stránky vyhľadávania.

## Dobré vedieť

- Ceny sú bez poštovného; vždy si ich over na stránke obchodu.
- Ak obchod zmení web alebo je nedostupný, appka ho v spodnej časti označí a ostatné obchody fungujú ďalej.
