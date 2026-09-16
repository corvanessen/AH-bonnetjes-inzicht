"""Bouw data/dashboard_data.json op uit de geparste bonnen/artikelen.

Draai dit na `uv run main.py`. Het resultaat is de databron voor
dashboard.html (start 'm met `uv run serve_dashboard.py`); die doet zelf de
aggregatie (per dag/maand, per categorie, filters), dit script levert alleen
de schone, compacte data.

De accountmapnaam (bv. `accounts/partner/`) is ook het label dat in het
dashboard verschijnt. Wil je daar een andere naam laten zien zonder de map
te hernoemen, zet dan een `accounts/labels.json` neer met een mapping van
mapnaam naar weergavenaam, bv. `{"partner": "Elke"}`. Die labels worden hier
toegepast, de brontabellen (en dus ook de mapnaam zelf) blijven ongewijzigd.

Gebruik:
    uv run export_dashboard_data.py                 # leest ./data, schrijft ./data/dashboard_data.json
    uv run export_dashboard_data.py --data andere/map
    uv run export_dashboard_data.py --labels accounts/labels.json
"""

import argparse
import json
from pathlib import Path

import pandas as pd


def laad_account_labels(labels_pad: Path) -> dict[str, str]:
    if not labels_pad.is_file():
        return {}
    return json.loads(labels_pad.read_text(encoding="utf-8"))


def bouw_dashboard_data(data_map: Path, account_labels: dict[str, str] | None = None) -> dict:
    account_labels = account_labels or {}
    bonnen = pd.read_parquet(data_map / "bonnen.parquet")
    artikelen = pd.read_parquet(data_map / "artikelen.parquet")

    producten = artikelen[artikelen["type"] == "product"].copy()
    producten["datum"] = pd.to_datetime(producten["datum"])
    bonnen = bonnen.copy()
    bonnen["datum"] = pd.to_datetime(bonnen["datum"])

    kpi = {
        "totaal_uitgegeven": round(float(bonnen["totaal"].sum()), 2),
        "aantal_bonnen": int(len(bonnen)),
        "gemiddelde_bonwaarde": round(float(bonnen["totaal"].mean()), 2) if len(bonnen) else 0.0,
        "totale_bonus_korting": round(float(bonnen["bonus_korting"].sum()), 2),
        "periode_van": bonnen["datum"].min().date().isoformat() if len(bonnen) else None,
        "periode_tot": bonnen["datum"].max().date().isoformat() if len(bonnen) else None,
    }

    accounts = sorted(
        {account_labels.get(a, a) for a in bonnen["account"].dropna().unique()}
    ) if "account" in bonnen.columns else []

    bonnen_records = [
        {
            "bon_id": rij.bon_id,
            "account": account_labels.get(rij.account, rij.account),
            "datum": rij.datum.date().isoformat(),
            "winkel_adres": rij.winkel_adres if pd.notna(rij.winkel_adres) else None,
            "subtotaal": round(float(rij.subtotaal), 2) if pd.notna(rij.subtotaal) else None,
            "bonus_korting": round(float(rij.bonus_korting), 2) if pd.notna(rij.bonus_korting) else 0.0,
            "totaal": round(float(rij.totaal), 2) if pd.notna(rij.totaal) else None,
        }
        for rij in bonnen.itertuples()
    ]

    artikelen_records = [
        {
            "bon_id": rij.bon_id,
            "account": account_labels.get(rij.account, rij.account),
            "datum": rij.datum.date().isoformat(),
            "omschrijving": rij.omschrijving,
            "categorie": rij.categorie,
            "subcategorie": rij.subcategorie if pd.notna(rij.subcategorie) else "overig",
            "bedrag": round(float(rij.bedrag), 2) if pd.notna(rij.bedrag) else 0.0,
            "bonus": bool(rij.bonus),
        }
        for rij in producten.itertuples()
    ]

    return {
        "gegenereerd_op": pd.Timestamp.now().isoformat(timespec="seconds"),
        "accounts": accounts,
        "kpi": kpi,
        "bonnen": bonnen_records,
        "artikelen": artikelen_records,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Bouw dashboard_data.json op uit de geparste bonnen/artikelen.")
    parser.add_argument("--data", default="data", help="Map met bonnen.parquet/artikelen.parquet (standaard: data)")
    parser.add_argument(
        "--labels",
        default="accounts/labels.json",
        help="JSON-bestand met mapping van accountmapnaam naar weergavenaam (standaard: accounts/labels.json, optioneel)",
    )
    args = parser.parse_args()

    data_map = Path(args.data)
    account_labels = laad_account_labels(Path(args.labels))
    dashboard_data = bouw_dashboard_data(data_map, account_labels)

    uitvoer_pad = data_map / "dashboard_data.json"
    uitvoer_pad.write_text(json.dumps(dashboard_data, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"{len(dashboard_data['bonnen'])} bonnen, {len(dashboard_data['artikelen'])} artikelregels")
    print(f"Weggeschreven naar {uitvoer_pad}")


if __name__ == "__main__":
    main()
