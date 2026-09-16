"""Lees de AH-kassabonnen van alle accounts in en schrijf ze weg als tabellen.

Elk account heeft zijn eigen map onder de accounts-map (standaard `accounts/`),
bv. `accounts/cor/` en `accounts/partner/`. Zo'n mapnaam wordt het account-
label in de tabellen en het dashboard. Binnen een accountmap worden twee
bronnen gecombineerd:
- *.pdf direct in de accountmap (kassabon-PDF's)
- *.json in <accountmap>/raw-jsons/data (digitale kassabon-export)

Een nieuw account toevoegen = een map aanmaken onder accounts/ en daar de
gedownloade PDF's/JSON-export in zetten; bestaande accounts blijven
onaangeroerd (elk account leest en schrijft alleen zijn eigen map).

Een bon die binnen een account in beide bronnen voorkomt (zelfde lokale
datum/tijd + totaalbedrag) wordt maar één keer meegeteld; de PDF-versie wint
dan omdat die het winkeladres en de bonus-vlag per artikel heeft. Dit
ontdubbelen gebeurt per account: bonnen van verschillende accounts worden
nooit tegen elkaar ontdubbeld, ook niet bij toevallig dezelfde datum/bedrag.

Gebruik:
    uv run main.py                     # leest accounts/*, schrijft naar ./data
    uv run main.py andere/accountsmap  # andere accounts-map
    uv run main.py --output uitvoer
    uv run main.py --demo              # geen eigen data nodig: genereert 3 maanden demo-boodschappen
"""

import argparse
from pathlib import Path

import pandas as pd

from ah_receipts import dedupliceer, genereer_demo_data, naverwerken, parse_folder, parse_json_folder


def verwerk_account(account_map: Path) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Parseer, ontdubbel en verrijk de data van één account."""
    account_naam = account_map.name

    pdf_bonnen, pdf_artikelen = parse_folder(account_map)
    json_bonnen, json_artikelen = parse_json_folder(account_map / "raw-jsons" / "data")
    bonnen_df, artikelen_df = dedupliceer(pdf_bonnen, pdf_artikelen, json_bonnen, json_artikelen)

    if bonnen_df.empty:
        return bonnen_df, artikelen_df

    # bon_id is alleen uniek binnen zijn eigen bron (bestandsnaam resp. AH-id);
    # prefixen met het account voorkomt botsingen zodra er meerdere accounts zijn.
    bonnen_df["bon_id"] = account_naam + "__" + bonnen_df["bon_id"].astype(str)
    artikelen_df["bon_id"] = account_naam + "__" + artikelen_df["bon_id"].astype(str)
    bonnen_df["account"] = account_naam
    artikelen_df["account"] = account_naam

    return naverwerken(bonnen_df, artikelen_df)


def main() -> None:
    parser = argparse.ArgumentParser(description="Parseer AH-kassabonnen (PDF + JSON) van alle accounts naar tabellen.")
    parser.add_argument("accounts_map", nargs="?", default="accounts", help="Map met één submap per account (standaard: accounts)")
    parser.add_argument("--output", default="data", help="Map om csv/parquet-bestanden weg te schrijven (standaard: data)")
    parser.add_argument(
        "--demo", action="store_true",
        help="Negeer accounts_map en genereer verzonnen demo-boodschappen (3 maanden, 2 fictieve accounts)",
    )
    args = parser.parse_args()

    uitvoermap = Path(args.output)
    uitvoermap.mkdir(parents=True, exist_ok=True)

    if args.demo:
        print("Demo-modus: genereer verzonnen boodschappen, geen echte kassabonnen.")
        bonnen_df, artikelen_df = genereer_demo_data()
    else:
        accounts_map = Path(args.accounts_map)
        account_dirs = sorted(p for p in accounts_map.iterdir() if p.is_dir()) if accounts_map.is_dir() else []
        if not account_dirs:
            raise SystemExit(
                f"Geen accountmappen gevonden in {accounts_map}/ (verwacht bv. {accounts_map}/cor/). "
                "Wil je eerst het dashboard uitproberen? Draai `uv run main.py --demo`."
            )

        alle_bonnen: list[pd.DataFrame] = []
        alle_artikelen: list[pd.DataFrame] = []
        for account_dir in account_dirs:
            bonnen_df, artikelen_df = verwerk_account(account_dir)
            if bonnen_df.empty:
                print(f"NB: geen bonnen gevonden voor account '{account_dir.name}', overgeslagen.")
                continue
            print(f"account '{account_dir.name}': {len(bonnen_df)} bonnetjes, {len(artikelen_df)} artikelregels.")
            alle_bonnen.append(bonnen_df)
            alle_artikelen.append(artikelen_df)

        if not alle_bonnen:
            raise SystemExit("Geen bonnen gevonden bij geen enkel account.")

        bonnen_df = pd.concat(alle_bonnen, ignore_index=True).sort_values("datum").reset_index(drop=True)
        artikelen_df = pd.concat(alle_artikelen, ignore_index=True).sort_values(["datum", "bon_id"]).reset_index(drop=True)

    bonnen_df.to_csv(uitvoermap / "bonnen.csv", index=False)
    artikelen_df.to_csv(uitvoermap / "artikelen.csv", index=False)
    bonnen_df.to_parquet(uitvoermap / "bonnen.parquet", index=False)
    artikelen_df.to_parquet(uitvoermap / "artikelen.parquet", index=False)

    aantal_accounts = bonnen_df["account"].nunique()
    print(f"Totaal: {len(bonnen_df)} bonnetjes over {aantal_accounts} account(s), {len(artikelen_df)} artikelregels gevonden.")
    print(f"Weggeschreven naar {uitvoermap}/ (bonnen.csv/.parquet, artikelen.csv/.parquet)")


if __name__ == "__main__":
    main()
