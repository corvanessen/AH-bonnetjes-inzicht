# AH bonnetjes

Leest Albert Heijn kassabonnen van één of meer accounts uit twee bronnen per
account en zet ze om naar twee tabellen:

- `accounts/<naam>/*.pdf` (kassabon-PDF's)
- `accounts/<naam>/raw-jsons/data/*.json` (digitale kassabon-export)

Een bon die binnen hetzelfde account in allebei voorkomt wordt maar één keer
meegeteld (zie "Ontdubbelen" hieronder) — dat gebeurt altijd per account, dus
bonnen van verschillende accounts worden nooit tegen elkaar ontdubbeld.

- **bonnen** — één rij per kassabon: `account`, datum, winkeladres, subtotaal,
  bonuskorting, totaal, betaalmethode, spaarzegels, `bron` (pdf/json), ...
- **artikelen** — één rij per gekocht product: `account`, omschrijving, categorie,
  aantal, stukprijs, bedrag, of er bonuskorting op zat (`bonus`), `product_id`
  (alleen bekend uit de JSON-bron), gekoppeld aan de bon (`bon_id`) en de datum
  ervan.

## Uitproberen met demo-data

Geen eigen kassabonnen nodig om het dashboard te zien: `--demo` genereert
verzonnen boodschappen (drie maanden, twee fictieve accounts "Anna" en
"Bram", verspreid over alle categorieën) in exact hetzelfde formaat als
echte data.

```
uv run main.py --demo              # schrijft demo-tabellen naar ./data
uv run export_dashboard_data.py
uv run serve_dashboard.py
```

Zodra je eigen accounts hebt toegevoegd (zie hieronder), vervangt een gewone
`uv run main.py` de demo-tabellen door je eigen data.

## Privacy

`accounts/` en `data/` staan in `.gitignore` en worden dus nooit gecommit:
je eigen kassabon-PDF's, JSON-exports, accountlabels en de opgebouwde
`dashboard_data.json` blijven altijd lokaal, ook als je deze repo forkt of
je eigen wijzigingen erop commit.

## Een account toevoegen

Maak een nieuwe map aan onder `accounts/`, bv. `accounts/elke/`, en zet
daar de gedownloade PDF's en/of de `raw-jsons/data`-export van dát account in.
Elk account heeft zijn eigen map, dus een download voor account B kan nooit
de bestanden van account A overschrijven — ze staan letterlijk in een andere
map. De mapnaam wordt het account-label in de tabellen en het dashboard
(filter verschijnt vanzelf zodra er meer dan één account data heeft).

Wil je in het dashboard een andere naam zien dan de mapnaam (bv. een
voornaam in plaats van een rol), zet dan `accounts/labels.json` neer met
een mapping, bv. `{"partner": "Elke"}`. Alleen `export_dashboard_data.py`
gebruikt dit bestand; de mapnaam en de tabellen zelf blijven ongewijzigd.

## Gebruik

```
uv run main.py                     # leest accounts/*, schrijft naar ./data
uv run main.py andere/accountsmap  # andere accounts-map (zelfde structuur: submap per account)
uv run main.py --output out        # andere uitvoermap
uv run main.py --demo              # geen eigen data? genereert demo-boodschappen (zie hieronder)
```

Zonder `--demo` en zonder gevulde `accounts/`-map stopt dit met een duidelijke
foutmelding — begin in dat geval met de demo-data (zie "Uitproberen met
demo-data" hieronder).

Dit schrijft `bonnen.csv`/`bonnen.parquet` en `artikelen.csv`/`artikelen.parquet`
weg naar de opgegeven map (standaard `data/`), met de data van alle accounts
samengevoegd.

Daarna, voor het dashboard:

```
uv run export_dashboard_data.py
uv run serve_dashboard.py
```

Het eerste commando bouwt `data/dashboard_data.json` op uit die twee tabellen,
het tweede serveert `dashboard.html` op een lokale poort en opent 'm in de
browser. Nieuwe bonnetjes toevoegen = `main.py` en `export_dashboard_data.py`
opnieuw draaien en de dashboardpagina verversen (de server hoeft niet
herstart te worden).

## Verkennen

```
uv run marimo edit verken_bonnetjes.py
```

opent een marimo-notebook dat de twee parquet-bestanden inleest en een paar
eerste overzichten toont (totaal per maand, meest gekochte producten,
bonus-effect). Werkt net zo goed als startpunt in Jupyter door de parquet-
bestanden met `pandas.read_parquet` in te lezen.

## Hoe het werkt

- `ah_receipts/parser.py` leest elke PDF met PyMuPDF op woordniveau in (positie
  + tekst) en groepeert woorden die op dezelfde hoogte staan tot een regel. Die
  regel wordt op basis van x-positie verdeeld over de vaste kolommen van de
  kassabon (AANTAL / OMSCHRIJVING / PRIJS / BEDRAG); een "B" na het bedrag
  betekent bonuskorting. Adres/datum/betaalmethode/spaarzegels staan niet in
  dat kolommenraster (en wisselen soms van taal, bv. bij een Duitse pinpas),
  dus die worden met patronen uit de platte tekst gehaald.
- `ah_receipts/json_parser.py` leest de digitale kassabon-JSON's. Schoner
  formaat (een echt product-`id` per artikel), maar mist het winkeladres, de
  statiegeldregels en de bonus-vlag per artikel (kortingen staan er alleen als
  totaalbedrag per bon, niet gekoppeld aan een specifiek artikel).
- `ah_receipts/samenvoegen.py` combineert de twee bronnen: **ontdubbelen** op
  (lokale datum, totaalbedrag) — de kassa-klok en het moment van digitale
  registratie lopen vaak een paar minuten uiteen, dus wordt er niet op de
  exacte minuut gematcht. Bij een match wint de PDF-versie (rijker: adres,
  bonus-vlag, statiegeld). Daarna wordt het winkeladres aangevuld en de
  categorie toegekend.
- `ah_receipts/categorisatie.py` kent een categorie toe via trefwoorden
  (`REGELS`) plus een handmatige uitzonderingenlijst
  (`categorie_overrides.csv`). Onherkende producten krijgen `"overig"` — bij
  elke run print het script hoeveel dat er zijn, zodat je weet of de
  trefwoorden/overrides bijwerken de moeite waard is.

Dit is gebouwd en getest tegen de PDF's en de ~220 bonnen in
`accounts/cor/raw-jsons/data`. Als AH het format wijzigt (andere
kolomposities in de PDF, andere velden in de JSON), kan de parser onverwacht
resultaten geven — controleer in dat geval de tabellen even steekproefsgewijs
tegen de originele bon.
