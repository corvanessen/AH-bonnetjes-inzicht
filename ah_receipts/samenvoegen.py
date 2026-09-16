"""Combineer de twee databronnen (PDF-kassabonnen + JSON-kassabonnen) tot de
uiteindelijke bonnen/artikelen-tabellen: bonnen ontdubbelen, categorie
toekennen, winkeladres aanvullen en kolommen in een vaste volgorde zetten.

Ontdubbelen gebeurt op (lokale datum/tijd tot op de minuut, totaalbedrag) -
geen van beide bronnen deelt een bon-id, maar een bon die in beide bronnen
voorkomt heeft wel dezelfde kassatransactie-timestamp en hetzelfde totaal.
Bij een match wint de PDF-versie: die heeft het winkeladres, de
bonus-vlag per artikel en de statiegeldregels, wat de JSON-bron niet heeft.
"""

from __future__ import annotations

import pandas as pd

from .categorisatie import categoriseer, categoriseer_sub

KOLOMVOLGORDE_BONNEN = [
    "bon_id", "account", "bestand", "bron", "datum", "winkel_adres", "winkel_nummer", "telefoon", "email",
    "klantenkaart", "totaal_aantal_stuks", "subtotaal", "bonus_korting", "bonus_box",
    "totaal", "betaalmethode", "betaald_bedrag", "spaarzegels",
]
KOLOMVOLGORDE_ARTIKELEN = [
    "bon_id", "account", "datum", "type", "omschrijving", "categorie", "subcategorie", "product_id",
    "aantal_weergave", "aantal", "stukprijs", "bedrag", "bonus",
]


MAX_TIJDSVERSCHIL = pd.Timedelta(minutes=30)


def _sleutel(datum, totaal):
    if datum is None or pd.isna(datum) or totaal is None or pd.isna(totaal):
        return None
    return (pd.Timestamp(datum).date(), round(float(totaal), 2))


def dedupliceer(
    pdf_bonnen: pd.DataFrame, pdf_artikelen: pd.DataFrame,
    json_bonnen: pd.DataFrame, json_artikelen: pd.DataFrame,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Voeg de twee bronnen samen en laat JSON-bonnen vallen die al als PDF aanwezig zijn.

    De PDF- en JSON-timestamp van dezelfde bon lopen soms 1-5 minuten uiteen
    (kassa-klok vs. moment van digitale bonnetje-registratie), dus matchen op
    exacte minuut mist echte duplicaten. In plaats daarvan: zelfde datum +
    zelfde totaalbedrag (op de cent), met een ruime tijdmarge (30 min) als
    extra check tegen toevallige samenloop.
    """
    pdf_per_sleutel: dict = {}
    if not pdf_bonnen.empty:
        for _, rij in pdf_bonnen.iterrows():
            sleutel = _sleutel(rij.get("datum"), rij.get("totaal"))
            if sleutel is not None:
                pdf_per_sleutel.setdefault(sleutel, []).append(rij["datum"])

    dubbele_bon_ids: set = set()
    if not json_bonnen.empty:
        for _, rij in json_bonnen.iterrows():
            sleutel = _sleutel(rij.get("datum"), rij.get("totaal"))
            kandidaten = pdf_per_sleutel.get(sleutel) if sleutel is not None else None
            if not kandidaten:
                continue
            if any(abs(rij["datum"] - pdf_datum) <= MAX_TIJDSVERSCHIL for pdf_datum in kandidaten):
                dubbele_bon_ids.add(rij["bon_id"])

    if dubbele_bon_ids:
        print(f"NB: {len(dubbele_bon_ids)} bon(nen) stonden al als PDF in de data; JSON-versie overgeslagen.")

    if not json_bonnen.empty:
        json_bonnen = json_bonnen[~json_bonnen["bon_id"].isin(dubbele_bon_ids)]
    if not json_artikelen.empty:
        json_artikelen = json_artikelen[~json_artikelen["bon_id"].isin(dubbele_bon_ids)]

    bonnen_df = pd.concat([pdf_bonnen, json_bonnen], ignore_index=True)
    artikelen_df = pd.concat([pdf_artikelen, json_artikelen], ignore_index=True)
    return bonnen_df, artikelen_df


def naverwerken(bonnen_df: pd.DataFrame, artikelen_df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Categorie toekennen, winkeladres aanvullen, kolommen op volgorde zetten.

    Roep dit per account aan (zie main.py), niet op de samengevoegde data van
    meerdere accounts: de adres-aanvulling neemt aan dat er in de meegegeven
    data hooguit één "thuiswinkel" voorkomt, wat alleen klopt binnen één
    account.
    """
    bonnen_df = bonnen_df.copy()
    artikelen_df = artikelen_df.copy()

    if "product_id" not in artikelen_df.columns:
        artikelen_df["product_id"] = None

    if not artikelen_df.empty:
        # statiegeld is geen aankoop, dus geen categorie (blijft buiten de geld-analyse)
        is_product = artikelen_df["type"] == "product"
        artikelen_df["categorie"] = None
        artikelen_df.loc[is_product, "categorie"] = [
            categoriseer(omschr, bedrag)
            for omschr, bedrag in zip(
                artikelen_df.loc[is_product, "omschrijving"], artikelen_df.loc[is_product, "bedrag"]
            )
        ]
        artikelen_df["subcategorie"] = None
        artikelen_df.loc[is_product, "subcategorie"] = [
            categoriseer_sub(omschr, cat, bedrag)
            for omschr, cat, bedrag in zip(
                artikelen_df.loc[is_product, "omschrijving"],
                artikelen_df.loc[is_product, "categorie"],
                artikelen_df.loc[is_product, "bedrag"],
            )
        ]

        onbekend = artikelen_df.loc[is_product & (artikelen_df["categorie"] == "overig"), "omschrijving"].unique()
        if len(onbekend):
            print(
                f"NB: {len(onbekend)} product(en) vielen op 'overig' (geen trefwoord/override gevonden): "
                + ", ".join(sorted(onbekend))
            )

    if not bonnen_df.empty:
        # 1) bonnen van hetzelfde winkelnummer waar het adres wel bekend is
        if "winkel_nummer" in bonnen_df and bonnen_df["winkel_nummer"].notna().any():
            adres_per_winkel = (
                bonnen_df.dropna(subset=["winkel_adres", "winkel_nummer"])
                .drop_duplicates("winkel_nummer")
                .set_index("winkel_nummer")["winkel_adres"]
            )
            ontbreekt = bonnen_df["winkel_adres"].isna() & bonnen_df["winkel_nummer"].notna()
            bonnen_df.loc[ontbreekt, "winkel_adres"] = bonnen_df.loc[ontbreekt, "winkel_nummer"].map(adres_per_winkel)

        # 2) de JSON-bron kent geen winkelnummer/adres; als er in de hele dataset
        # maar één adres bekend is, mag je aannemen dat de rest ook daar vandaan komt
        bekende_adressen = bonnen_df["winkel_adres"].dropna().unique()
        ontbreekt = bonnen_df["winkel_adres"].isna()
        if len(bekende_adressen) == 1 and ontbreekt.any():
            bonnen_df.loc[ontbreekt, "winkel_adres"] = bekende_adressen[0]
        elif len(bekende_adressen) > 1 and ontbreekt.any():
            print(
                f"NB: {ontbreekt.sum()} bon(nen) hebben geen bekend adres en er zijn meerdere "
                f"winkeladressen in de data ({', '.join(bekende_adressen)}) - niet automatisch aangevuld."
            )

    for kolom in KOLOMVOLGORDE_BONNEN:
        if kolom not in bonnen_df.columns:
            bonnen_df[kolom] = None
    for kolom in KOLOMVOLGORDE_ARTIKELEN:
        if kolom not in artikelen_df.columns:
            artikelen_df[kolom] = None

    if not bonnen_df.empty:
        bonnen_df = bonnen_df[KOLOMVOLGORDE_BONNEN].sort_values("datum").reset_index(drop=True)
    if not artikelen_df.empty:
        artikelen_df = artikelen_df[KOLOMVOLGORDE_ARTIKELEN].sort_values(["datum", "bon_id"]).reset_index(drop=True)

    return bonnen_df, artikelen_df
