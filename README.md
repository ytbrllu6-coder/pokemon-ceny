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
| ihrysko.sk | výpis kategórie „Pokémon TCG“ (HTML), sťahuje sa na pozadí |
| smarty.sk | výpis kategórie „Pokémon karty“ (HTML), sťahuje sa na pozadí |

Použité sú len verejné rozhrania a stránky, ktoré robots.txt daného obchodu nezakazuje.

**iHRYsko a Smarty** nemajú vyhľadávacie API (Smarty má vyhľadávanie v robots.txt zakázané), preto appka na pozadí
stiahne výpis ich Pokémon kategórie (1 požiadavka za sekundu; iHRYsko ~54 strán raz za 3 hodiny, Smarty ~7 strán raz za
30 minút) a hľadá v ňom sama. Po spustení servera trvá prvé načítanie iHRYska okolo minúty, dovtedy appka pri ňom
zobrazí „sa práve načítava“. Čo sa z obchodov vyčítalo, ukáže `/api/debug?shop=ihrysko` (alebo `smarty`), vrátane
vzorky zdrojového HTML. Parser číta HTML bez ohľadu na CSS triedy, takže ho treba po zmene webu obchodu skontrolovať.

### Pridanie ďalšieho obchodu

V `shops.js` pridaj riadok do poľa `SHOPS`:

```js
shopify({ id: 'mojobchod', name: 'Môj obchod', base: 'https://www.mojobchod.sk' }),
woocommerce({ id: 'iny', name: 'Iný', base: 'https://iny.sk' }),
```

Pred pridaním skontroluj `https://obchod.sk/robots.txt` – ak zakazuje vyhľadávanie alebo API, obchod radšej nepridávaj.

### Vedome vynechané

Alza.sk a Kaufland.sk automatizovaný prístup výslovne zakazujú. Heureka.sk obmedzuje vyhľadávanie v robots.txt. Nekonecno.sk, cardempire.sk, beardex.eu a pokecardsk.sk majú v robots.txt zakázané stránky vyhľadávania.

## Dobré vedieť

- Ceny sú bez poštovného; vždy si ich over na stránke obchodu.
- Ak obchod zmení web alebo je nedostupný, appka ho v spodnej časti označí a ostatné obchody fungujú ďalej.
