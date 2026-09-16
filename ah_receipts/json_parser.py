"""Parser voor de tweede databron: digitale kassabonnen als los JSON-bestand per bon
(bv. `raw-jsons/data/2025-12-20T15-40-00__AH2605....json`).

Dit formaat is veel schoner dan de PDF (een echt product-`id` per artikel, geen
kolomposities om te raden), maar mist een paar dingen die de PDF wel heeft: geen
winkeladres, geen statiegeld-regels, en geen bonus-vlag per artikel (alleen een
lijst kortingen op bonniveau, niet gekoppeld aan een specifiek artikel).

De timestamp in het bestand is UTC; we zetten 'm om naar Europe/Amsterdam
zodat bonnen die in beide bronnen voorkomen exact dezelfde lokale datum/tijd
krijgen als de PDF-versie (nodig voor het ontdubbelen in `samenvoegen.py`).
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd

NL_TZ = ZoneInfo("Europe/Amsterdam")

_ENCODINGS = ("utf-8", "utf-8-sig", "cp1252", "latin-1")


def _lees_json(pad: Path) -> dict:
    ruwe_bytes = pad.read_bytes()
    for encoding in _ENCODINGS:
        try:
            import json

            return json.loads(ruwe_bytes.decode(encoding))
        except (UnicodeDecodeError, ValueError):
            continue
    raise ValueError(f"kon {pad.name} met geen van de bekende encodings decoderen")


def _naar_lokale_tijd(iso_utc: str) -> datetime:
    utc_dt = datetime.fromisoformat(iso_utc.replace("Z", "+00:00"))
    return utc_dt.astimezone(NL_TZ).replace(tzinfo=None)


def parse_json_bon(json_pad: Path) -> tuple[dict, list[dict]]:
    """Parseer één bon-JSON. Returns een (bon, artikelen)-tuple, zelfde vorm als parser.parse_receipt."""
    ruw = _lees_json(json_pad)

    lokale_datum = _naar_lokale_tijd(ruw["dateTime"]) if ruw.get("dateTime") else None
    totaal = ruw.get("totalAmount")
    kortingen = ruw.get("discounts") or []
    bonus_korting = round(-sum(k["amount"]["amount"] for k in kortingen), 2) if kortingen else 0.0
    subtotaal = round(totaal + bonus_korting, 2) if totaal is not None else None

    betalingen = ruw.get("payments") or []
    betaalmethode = ", ".join(sorted({p["method"] for p in betalingen if p.get("method")})) or None
    betaald_bedrag = round(sum(p["amount"]["amount"] for p in betalingen), 2) if betalingen else None

    bon_id = ruw["id"]
    bon = {
        "bon_id": bon_id,
        "bestand": json_pad.name,
        "bron": "json",
        "winkel_adres": None,
        "telefoon": None,
        "email": None,
        "winkel_nummer": None,
        "datum": lokale_datum,
        "totaal_aantal_stuks": sum((p.get("quantity") or 1) for p in (ruw.get("products") or [])),
        "subtotaal": subtotaal,
        "bonus_korting": bonus_korting,
        "bonus_box": None,
        "totaal": totaal,
        "klantenkaart": None,
        "betaalmethode": betaalmethode,
        "betaald_bedrag": betaald_bedrag,
        "spaarzegels": None,
    }

    artikelen: list[dict] = []
    for product in ruw.get("products") or []:
        aantal = product.get("quantity", 1)
        bedrag = (product.get("amount") or {}).get("amount")
        prijs_veld = product.get("price")
        stukprijs = prijs_veld["amount"] if prijs_veld else bedrag
        artikelen.append({
            "bon_id": bon_id,
            "datum": lokale_datum,
            "type": "product",
            "omschrijving": (product.get("name") or "").strip(),
            "product_id": product.get("id"),
            "aantal_weergave": str(aantal),
            "aantal": float(aantal) if aantal is not None else None,
            "stukprijs": stukprijs,
            "bedrag": bedrag,
            "bonus": None,  # niet af te leiden: kortingen staan hier los van specifieke artikelen
        })

    return bon, artikelen


def parse_json_folder(map_pad: Path) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Parseer alle *.json bestanden in een map naar twee tabellen (bonnen, artikelen)."""
    map_pad = Path(map_pad)
    bonnen: list[dict] = []
    artikelen: list[dict] = []

    for json_pad in sorted(map_pad.glob("*.json")):
        try:
            bon, items = parse_json_bon(json_pad)
        except Exception as exc:  # een kapot/onverwacht bestand mag de rest niet blokkeren
            print(f"WAARSCHUWING: kon {json_pad.name} niet verwerken: {exc}")
            continue
        bonnen.append(bon)
        artikelen.extend(items)

    return pd.DataFrame(bonnen), pd.DataFrame(artikelen)
