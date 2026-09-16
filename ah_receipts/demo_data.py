"""Genereer synthetische demo-boodschappen, voor wie het dashboard wil
uitproberen zonder eigen kassabonnen aan te leveren.

Levert data in exact hetzelfde schema als de rest van de pipeline
(`ah_receipts.samenvoegen.KOLOMVOLGORDE_BONNEN`/`KOLOMVOLGORDE_ARTIKELEN`), zodat
`export_dashboard_data.py` en `serve_dashboard.py` hier ongewijzigd op werken.
Categorie/subcategorie worden via de echte `categoriseer()`/`categoriseer_sub()`
bepaald (geen aparte demo-categorielogica), dus de indeling in het dashboard
blijft in sync met de trefwoordregels.
"""

from __future__ import annotations

import random
from datetime import timedelta

import pandas as pd

from .categorisatie import categoriseer, categoriseer_sub
from .samenvoegen import KOLOMVOLGORDE_ARTIKELEN, KOLOMVOLGORDE_BONNEN

# Twee fictieve accounts, zodat het multi-account-filter in het dashboard ook
# in de demo meteen te zien is. Adressen zijn verzonnen, geen bestaand filiaal.
DEMO_ACCOUNTS = [
    {"naam": "Anna", "adres": "Albert Heijn (demo), Voorbeeldstraat 1, 1234 AB Nergenshuizen"},
    {"naam": "Bram", "adres": "Albert Heijn (demo), Marktplein 8, 5678 CD Verzinstad"},
]

# (omschrijving, richtprijs, min_aantal, max_aantal) - omschrijvingen zijn
# gekozen zodat ze de trefwoorden in categorisatie.REGELS raken, voor een
# realistische categorieverdeling in de demo.
PRODUCTEN: list[tuple[str, float, int, int]] = [
    ("AH HVOL MELK", 1.39, 1, 2),
    ("YOGHURT NAT", 1.89, 1, 1),
    ("OUDE KAAS", 5.49, 1, 1),
    ("ROOMBOTER", 2.79, 1, 1),
    ("EIEREN 10ST", 2.99, 1, 1),
    ("KOMKOMMER", 0.89, 1, 1),
    ("TOMATEN TROS", 2.19, 1, 1),
    ("PAPRIKA ROOD", 1.49, 1, 2),
    ("GELE UI NET", 1.19, 1, 1),
    ("BROCCOLI", 1.39, 1, 1),
    ("SPINAZIE VERS", 1.99, 1, 1),
    ("BANANEN", 1.69, 1, 1),
    ("APPELS ELSTAR", 2.29, 1, 1),
    ("SINAASAPPELS", 2.49, 1, 1),
    ("AARDBEIEN", 2.99, 1, 1),
    ("DRUIVEN WIT", 2.99, 1, 1),
    ("KIPFILET", 5.99, 1, 1),
    ("GEHAKT HOH", 4.49, 1, 1),
    ("TOFU NATUREL", 2.19, 1, 1),
    ("SALAMI", 2.39, 1, 1),
    ("SCHNITZEL NAT", 4.99, 1, 1),
    ("VOLKORENBROOD", 1.99, 1, 1),
    ("CROISSANTS", 2.49, 1, 1),
    ("STOKBROOD", 1.29, 1, 2),
    ("WRAP TORTILLA", 1.99, 1, 1),
    ("MUESLI NOTEN", 2.99, 1, 1),
    ("CHIPS PAPRIKA", 1.79, 1, 1),
    ("CHOCOLADE REEP", 1.69, 1, 2),
    ("HARIBO MIX", 1.29, 1, 1),
    ("PINDA GEZOUTEN", 1.49, 1, 1),
    ("PRINGLES ORIG", 2.49, 1, 1),
    ("COCA-COLA 1.5L", 2.29, 1, 1),
    ("SPA BLAUW WATER", 1.09, 1, 2),
    ("LIPTON ICE TEA", 1.99, 1, 1),
    ("DE KOFFIE PAK", 4.49, 1, 1),
    ("AH SAP SINAAS", 1.89, 1, 1),
    ("WASMIDDEL", 6.99, 1, 1),
    ("TOILETPAPIER", 5.49, 1, 1),
    ("VAAT TAB", 4.99, 1, 1),
    ("KEUKENPAPIER", 2.99, 1, 1),
    ("VUILNISZAKKEN", 2.49, 1, 1),
    ("TANDPASTA", 2.19, 1, 1),
    ("SHAMPOO", 3.49, 1, 1),
    ("DEOSPRAY", 2.99, 1, 1),
    ("ZEEP HANDZEEP", 1.79, 1, 1),
    ("NIVEA CREME", 3.99, 1, 1),
    ("PASTA PENNE", 1.09, 1, 2),
    ("BASMATI RIJST", 2.49, 1, 1),
]

BETAALMETHODE = "PINNEN"


def genereer_demo_data(aantal_maanden: int = 3, seed: int = 42) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Genereer `aantal_maanden` maanden verzonnen boodschappen voor de demo-accounts.

    Reproduceerbaar via `seed`. Retourneert (bonnen_df, artikelen_df) in het
    standaard kolomschema, alsof ze net door `main.py` waren ingelezen.
    """
    rng = random.Random(seed)
    vandaag = pd.Timestamp.now().normalize()
    start = vandaag - pd.DateOffset(months=aantal_maanden)

    alle_bonnen: list[dict] = []
    alle_artikelen: list[dict] = []

    for account in DEMO_ACCOUNTS:
        account_naam = account["naam"]
        bon_teller = 0
        datum = start + timedelta(days=rng.randint(0, 3))

        while datum <= vandaag:
            bon_teller += 1
            bon_id = f"{account_naam.lower()}__{bon_teller:04d}"
            tijd = datum + timedelta(hours=rng.randint(8, 20), minutes=rng.randint(0, 59))

            n_items = rng.randint(5, 15)
            gekozen = rng.sample(PRODUCTEN, k=min(n_items, len(PRODUCTEN)))

            subtotaal = 0.0
            bonus_korting = 0.0
            totaal_aantal_stuks = 0
            for omschr, richtprijs, min_a, max_a in gekozen:
                aantal = rng.randint(min_a, max_a)
                stukprijs = round(richtprijs * rng.uniform(0.95, 1.05), 2)
                bedrag = round(stukprijs * aantal, 2)
                bonus = rng.random() < 0.15
                categorie = categoriseer(omschr, bedrag)
                subcategorie = categoriseer_sub(omschr, categorie, bedrag)

                alle_artikelen.append({
                    "bon_id": bon_id, "account": account_naam, "datum": tijd,
                    "type": "product", "omschrijving": omschr, "categorie": categorie,
                    "subcategorie": subcategorie, "product_id": None,
                    "aantal_weergave": str(aantal), "aantal": float(aantal),
                    "stukprijs": stukprijs, "bedrag": bedrag, "bonus": bonus,
                })
                subtotaal += bedrag
                totaal_aantal_stuks += aantal
                if bonus:
                    bonus_korting += round(bedrag * 0.15, 2)

            if rng.random() < 0.2:
                statiegeld_bedrag = round(rng.uniform(0.15, 1.50), 2)
                alle_artikelen.append({
                    "bon_id": bon_id, "account": account_naam, "datum": tijd,
                    "type": "statiegeld", "omschrijving": "STATIEGELD", "categorie": None,
                    "subcategorie": None, "product_id": None,
                    "aantal_weergave": None, "aantal": None,
                    "stukprijs": None, "bedrag": statiegeld_bedrag, "bonus": False,
                })
                subtotaal += statiegeld_bedrag

            subtotaal = round(subtotaal, 2)
            bonus_korting = round(bonus_korting, 2)
            totaal = round(subtotaal - bonus_korting, 2)

            alle_bonnen.append({
                "bon_id": bon_id, "account": account_naam, "bestand": None, "bron": "demo",
                "datum": tijd, "winkel_adres": account["adres"], "winkel_nummer": None,
                "telefoon": None, "email": None, "klantenkaart": None,
                "totaal_aantal_stuks": totaal_aantal_stuks, "subtotaal": subtotaal,
                "bonus_korting": bonus_korting, "bonus_box": None, "totaal": totaal,
                "betaalmethode": BETAALMETHODE, "betaald_bedrag": totaal,
                "spaarzegels": rng.choice([None, None, None, 1, 2]),
            })

            datum += timedelta(days=rng.randint(2, 4))

    bonnen_df = pd.DataFrame(alle_bonnen)
    artikelen_df = pd.DataFrame(alle_artikelen)

    for kolom in KOLOMVOLGORDE_BONNEN:
        if kolom not in bonnen_df.columns:
            bonnen_df[kolom] = None
    for kolom in KOLOMVOLGORDE_ARTIKELEN:
        if kolom not in artikelen_df.columns:
            artikelen_df[kolom] = None

    bonnen_df = bonnen_df[KOLOMVOLGORDE_BONNEN].sort_values("datum").reset_index(drop=True)
    artikelen_df = artikelen_df[KOLOMVOLGORDE_ARTIKELEN].sort_values(["datum", "bon_id"]).reset_index(drop=True)
    return bonnen_df, artikelen_df
