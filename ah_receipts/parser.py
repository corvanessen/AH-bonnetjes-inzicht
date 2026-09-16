"""Parser voor Albert Heijn kassabon-PDF's.

De kassabon is opgebouwd uit vaste kolommen (AANTAL / OMSCHRIJVING / PRIJS /
BEDRAG). We lezen elk woord met zijn positie op de pagina (via PyMuPDF),
groeperen woorden die op dezelfde hoogte staan tot een "regel", en verdelen
die regel op basis van de x-positie in kolommen. Bonuskorting wordt herkend
aan de "B" die achter de prijs staat.

De overige velden (datum, betaalmethode, spaarzegels, ...) staan niet in een
strak kolommenraster en de content daaromheen wisselt per bon (bv. de taal
van de pin-transactie), dus die halen we via patroon-herkenning uit de platte
tekst.
"""

from __future__ import annotations

import re
from pathlib import Path

import pandas as pd
import pymupdf

# x-grenzen (in PDF-punten) van de kolommen in de artikeltabel
QTY_MAX_X = 70.0
DESC_MAX_X = 190.0
PRICE_MAX_X = 219.0
BEDRAG_MAX_X = 250.0
# alles rechts van BEDRAG_MAX_X is de bonus-vlag ("B")

ROW_TOLERANCE = 2.0  # punten; woorden op dezelfde gedrukte regel delen vrijwel dezelfde y0


def _group_rows(doc: pymupdf.Document) -> list[dict[str, str]]:
    """Lees alle woorden van alle pagina's en verdeel ze in regels + kolommen.

    De aantal/omschrijving-kolommen zijn links uitgelijnd (vaste x0), maar
    prijs/bedrag zijn rechts uitgelijnd op een vaste rand (x1). Bij grotere
    bedragen (bv. "120,40") schuift x0 naar links op, dus die kolommen moeten
    op x1 worden geclassificeerd - anders belandt een breed bedrag per ongeluk
    in de prijskolom.
    """
    rows: list[dict[str, str]] = []

    for page in doc:
        words = page.get_text("words")  # (x0, y0, x1, y1, tekst, block_no, line_no, word_no)
        words.sort(key=lambda w: (round(w[1]), w[0]))

        row_words: list[tuple[float, float, str]] = []
        current_y: float | None = None

        def flush() -> None:
            if not row_words:
                return
            cols: dict[str, list[str]] = {
                "aantal": [], "omschrijving": [], "prijs": [], "bedrag": [], "vlag": [],
            }
            for x0, x1, text in row_words:
                if x0 < QTY_MAX_X:
                    cols["aantal"].append(text)
                elif x0 < DESC_MAX_X:
                    cols["omschrijving"].append(text)
                elif x1 <= PRICE_MAX_X:
                    cols["prijs"].append(text)
                elif x1 <= BEDRAG_MAX_X:
                    cols["bedrag"].append(text)
                else:
                    cols["vlag"].append(text)
            rows.append({key: " ".join(vals) for key, vals in cols.items()})

        for w in words:
            y0 = round(w[1])
            if current_y is None or abs(y0 - current_y) > ROW_TOLERANCE:
                flush()
                row_words = []
                current_y = y0
            row_words.append((w[0], w[2], w[4]))
        flush()

    return rows


def _parse_bedrag(tekst: str) -> float | None:
    tekst = tekst.strip()
    if not tekst:
        return None
    try:
        return float(tekst.replace(".", "").replace(",", "."))
    except ValueError:
        return None


def _parse_aantal(tekst: str) -> tuple[str | None, float | None]:
    tekst = tekst.strip()
    if not tekst:
        return None, None
    match = re.match(r"^(\d+(?:[.,]\d+)?)", tekst)
    if not match:
        return tekst, None
    return tekst, float(match.group(1).replace(",", "."))


def _parse_artikeltabel(rows: list[dict[str, str]]) -> tuple[list[dict], dict]:
    """Loop door de gegroepeerde regels en bouw de artikelregels + bon-totalen op."""
    items: list[dict] = []
    totals: dict = {
        "klantenkaart": None,
        "totaal_aantal_stuks": None,
        "subtotaal": None,
        "bonus_korting": None,
        "bonus_box": None,
        "totaal": None,
    }

    state = "voor_tabel"

    for row in rows:
        aantal, omschrijving, prijs, bedrag, vlag = (
            row["aantal"], row["omschrijving"], row["prijs"], row["bedrag"], row["vlag"],
        )

        if state == "voor_tabel":
            if omschrijving == "OMSCHRIJVING":
                state = "na_header"
            continue

        if state == "na_header":
            if omschrijving.startswith("BONUSKAART"):
                totals["klantenkaart"] = bedrag.strip() or None
                continue
            state = "artikelen"
            # let door naar het "artikelen"-blok hieronder, deze regel is al een item

        if state == "artikelen":
            if omschrijving == "SUBTOTAAL":
                _, totals["totaal_aantal_stuks"] = _parse_aantal(aantal)
                totals["subtotaal"] = _parse_bedrag(bedrag)
                state = "na_artikelen"
                continue
            if omschrijving.startswith("+STATIEGELD"):
                items.append({
                    "type": "statiegeld",
                    "aantal_weergave": None,
                    "aantal": None,
                    "omschrijving": "STATIEGELD",
                    "stukprijs": None,
                    "bedrag": _parse_bedrag(bedrag),
                    "bonus": False,
                })
                continue
            if not omschrijving:
                continue  # lege/overslaande regel (bv. pagina-einde), niets aan de hand
            aantal_weergave, aantal_num = _parse_aantal(aantal)
            stukprijs = _parse_bedrag(prijs) if prijs.strip() else _parse_bedrag(bedrag)
            items.append({
                "type": "product",
                "aantal_weergave": aantal_weergave,
                "aantal": aantal_num,
                "omschrijving": omschrijving.strip(),
                "stukprijs": stukprijs,
                "bedrag": _parse_bedrag(bedrag),
                "bonus": vlag.strip() == "B",
            })
            continue

        if state == "na_artikelen":
            if aantal.strip() == "TOTAAL":
                totals["totaal"] = _parse_bedrag(bedrag)
                break
            if aantal.strip() == "BONUS":
                # een regel per bonusactie (bv. "ALLECROKY -1,20"); de betrokken
                # artikelen hebben zelf al bonus=True. "UW VOORDEEL" hieronder
                # geeft de betrouwbare som van deze regels.
                continue
            if aantal.strip() == "UW VOORDEEL":
                totals["bonus_korting"] = _parse_bedrag(bedrag)
                continue
            if omschrijving.strip() == "BONUS BOX":
                totals["bonus_box"] = _parse_bedrag(bedrag)
                continue
            continue  # bv. "Waarvan"

    return items, totals


def _parse_header_en_footer(volledige_tekst: str) -> dict:
    """Haal adres, datum/tijd, betaalmethode en spaarzegels uit de platte tekst."""
    info: dict = {
        "winkel_adres": None,
        "telefoon": None,
        "email": None,
        "winkel_nummer": None,
        "datum": None,
        "betaalmethode": None,
        "betaald_bedrag": None,
        "spaarzegels": None,
    }

    kop_regels: list[str] = []
    for regel in volledige_tekst.splitlines():
        if regel.strip() == "AANTAL":
            break
        kop_regels.append(regel.strip())

    for regel in kop_regels:
        if not regel:
            continue
        if re.fullmatch(r"\d{3,5}", regel):
            info["winkel_nummer"] = regel
        elif regel.lower().startswith("tel:"):
            info["telefoon"] = regel.split(":", 1)[1].strip()
        elif regel.lower().startswith("email:"):
            info["email"] = regel.split(":", 1)[1].strip()
        else:
            info["winkel_adres"] = (
                regel if not info["winkel_adres"] else f"{info['winkel_adres']} {regel}"
            )

    match = re.search(r"\bDatum\n(\d{2})/(\d{2})/(\d{4}) (\d{2}:\d{2})", volledige_tekst)
    if match:
        dag, maand, jaar, tijd = match.groups()
        info["datum"] = pd.to_datetime(f"{jaar}-{maand}-{dag} {tijd}", format="%Y-%m-%d %H:%M")

    match = re.search(r"BETAALD MET:\n([A-Za-z .]+)\n([\d,]+)", volledige_tekst)
    if match:
        info["betaalmethode"] = match.group(1).strip()
        info["betaald_bedrag"] = _parse_bedrag(match.group(2))

    match = re.search(r"SPAARACTIES:\n(\d+)\ne?SPAARZEGELS?", volledige_tekst)
    if match:
        info["spaarzegels"] = int(match.group(1))

    if info["winkel_nummer"] is None:
        # sommige bonnen tonen het winkelnummer niet in de kop maar alleen in de
        # voettekst, vlak voor de sluittijd/-datum, bv. "1557\n36\n131\n17:10\n27-11-2025"
        match = re.search(r"\n(\d{3,5})\n\d+\n\d+\n\d{1,2}:\d{2}\n\d{1,2}-\d{1,2}-\d{4}\n", volledige_tekst)
        if match:
            info["winkel_nummer"] = match.group(1)

    return info


def parse_receipt(pdf_pad: Path) -> tuple[dict, list[dict]]:
    """Parseer één kassabon-PDF.

    Returns een (bon, artikelen)-tuple: `bon` is een dict met de
    bon-brede velden, `artikelen` is een lijst met een dict per artikelregel.
    """
    doc = pymupdf.open(pdf_pad)
    volledige_tekst = "\n".join(page.get_text() for page in doc)
    rows = _group_rows(doc)
    doc.close()

    artikelen, totalen = _parse_artikeltabel(rows)
    header_footer = _parse_header_en_footer(volledige_tekst)

    bon_id = pdf_pad.stem
    bon = {
        "bon_id": bon_id,
        "bestand": pdf_pad.name,
        "bron": "pdf",
        **header_footer,
        "totaal_aantal_stuks": totalen["totaal_aantal_stuks"],
        "subtotaal": totalen["subtotaal"],
        "bonus_korting": totalen["bonus_korting"],
        "bonus_box": totalen["bonus_box"],
        "totaal": totalen["totaal"],
        "klantenkaart": totalen["klantenkaart"],
    }

    for artikel in artikelen:
        artikel["bon_id"] = bon_id
        artikel["datum"] = bon["datum"]

    return bon, artikelen


def parse_folder(map_pad: Path) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Parseer alle *.pdf bestanden in een map naar twee tabellen (bonnen, artikelen).

    Levert de ruwe, per-bron velden (geen categorie, geen adres-aanvulling,
    geen vaste kolomvolgorde) - dat gebeurt centraal in
    `ah_receipts.samenvoegen`, nadat deze data eventueel is samengevoegd met
    een andere bron (bv. `json_parser.parse_json_folder`) en ontdubbeld.
    """
    map_pad = Path(map_pad)
    bonnen: list[dict] = []
    artikelen: list[dict] = []

    for pdf_pad in sorted(map_pad.glob("*.pdf")):
        try:
            bon, items = parse_receipt(pdf_pad)
        except Exception as exc:  # een kapotte/onverwachte PDF mag de rest niet blokkeren
            print(f"WAARSCHUWING: kon {pdf_pad.name} niet verwerken: {exc}")
            continue
        bonnen.append(bon)
        artikelen.extend(items)

    return pd.DataFrame(bonnen), pd.DataFrame(artikelen)
