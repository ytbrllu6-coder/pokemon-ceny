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

Po kliknutí na názov produktu sa otvorí okno so všetkými produktmi rovnakého typu a edície (napr. všetky tinky 30th Celebration). Typ a edícia sa rozpoznávajú z názvu podľa zoznamu v `search.js` (`SETS`), ktorý treba pri nových edíciách doplniť.

Skratky: `etb` = elite trainer box, `upc` = ultra premium collection, `bb` = booster box.

## Zapojené obchody

| Obchod | Spôsob |
|---|---|
| cardyx.sk | Shopify `/search/suggest.json` |
| 64ka.sk | Shopify `/search/suggest.json` |
| 365tcg.sk | WooCommerce Store API |
| ihrysko.sk | výpis kategórie „Pokémon TCG“ (HTML), sťahuje sa na pozadí |

Použité sú len verejné rozhrania a stránky, ktoré robots.txt daného obchodu nezakazuje.

**iHRYsko** nemá vyhľadávacie API, preto appka na pozadí stiahne výpis jeho Pokémon kategórie (1 požiadavka za sekundu,
~54 strán raz za 3 hodiny) a hľadá v ňom sama. **Smarty** je vypnutý: jeho server automatizované požiadavky blokuje (HTTP 403),
zdrojový kód je v `shops.js` zakomentovaný. Po spustení servera trvá prvé načítanie iHRYska okolo minúty, dovtedy appka pri ňom
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


## Skenovanie kariet (mobil)

Tlačidlo „Skenovať kartu a zistiť cenu“ v úvode otvorí fotoaparát. Text z fotky (názov a číslo, napr. 123/191) sa prečíta priamo v telefóne cez tesseract.js, takže fotka sa nikam neposiela. Cena sa potom nájde cez Pokémon TCG API (`/api/card`) a zobrazí sa 30-dňový priemer z Cardmarketu a „tvoja cena“ ako percento z neho (predvolene 90 %, upraviteľné, pamätá sa v prehliadači).

Voliteľne nastav v Renderi (Environment) premennú `POKEMONTCG_API_KEY` pre vyšší denný limit API.

## Smarty

Smarty vracia nášmu serveru HTTP 403, a blokovanie neobchádzame. Pod výsledkami sú preto odkazy, ktoré Smarty otvoria priamo v tvojom prehliadači. Ceny priamo v appke by išli len s ich povolením alebo feedom.

### Smarty cez záložku

Na stránke `/smarty.html` je záložka (bookmarklet). Keď ju klikneš na smarty.sk, tvoj prehliadač načíta výpis Pokémon kategórie (max. 15 strán, 1 za sekundu) a pošle ho do PokéCien. Server HTML len spracuje (`/api/parse-listing`), nič neukladá, a ponuky sa uložia do localStorage tvojho prehliadača. Nič sa neobchádza.

Automaticky: `/pokeceny-smarty.user.js` je skript pre Tampermonkey/Userscripts. Pri otvorení PokéCien si prehliadač používateľa sám načíta Smarty (najviac raz za 6 hodín, 1 požiadavka za sekundu).
